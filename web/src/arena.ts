/**
 * 水墨斗法场：游戏的核心演出层（DOM + Canvas 2D 实现）
 * 米白宣纸底 + 淡墨座次环；玩家以「圆点座次令牌」表示（座次数字入点，名号其下）
 * 14 招特效全部采用水墨素材包体系：三段式演出（蓄力→爆发→消散）+ 粒子 + 顿帧 + 运镜
 * 打击感原语：shake / zoomPunch / hitStop / flash / darken / floatText
 */
import { MOVES } from '@shared/moves';
import { eventPaceMs } from '@shared/pacing';
import type { GameEvent, MoveId } from '@shared/types';
import { InkParticles } from './inkParticles';
import { sfx } from './sfx';

export interface ArenaPlayer {
  id: string; name: string;
  hp: number; maxHp: number; v: number; alive: boolean;
  picked?: boolean;
}

interface Seat {
  id: string; num: number; name: string;    // 座次序号（入座顺序，1 起）与名号（招式名定格归属用）
  el: HTMLElement;
  x: number; y: number;
  flying: boolean; underground: boolean; shield: 0 | 1 | 2;
  shieldFxEl: HTMLElement | null;   // 常驻呼吸盾效
  stateFxEl: HTMLElement | null;    // 飞天/遁地常驻墨效
  v: number;                        // 上次同步的 V（变化时令牌数字脉冲）
}

/** 弹道飞行句柄：反制/对冲打断时中止飞行并碎裂 */
interface FlightHandle { abort: () => void }

/** 施法会话：一次 reveal 对应的飞行物与收场逻辑（被破时统一回收） */
interface CastSession { flights: Set<FlightHandle>; fizzle?: () => void; broken?: boolean }

/** reveal 演出排期：结算事件相对本 reveal 的延迟（弹道对齐用） */
interface CastSched { impactDelayMs?: number; session?: CastSession }

const fxUrl = (m: string) => `/inkfx/${m}.webp`;
/** 招式题名美术字（AI 生图，规格见 docs/superpowers/specs/2026-08-20-skill-title-art-requirements.md） */
const titleUrl = (m: string) => `/titles/title-${m}.webp`;
/** 施法者朱砂法环（SVG 双环，走 img 特效管线） */
const CAST_RING_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
  `<circle cx='50' cy='50' r='42' fill='none' stroke='rgba(178,34,34,0.95)' stroke-width='6'/>` +
  `<circle cx='50' cy='50' r='33' fill='none' stroke='rgba(178,34,34,0.35)' stroke-width='2.5'/></svg>`);
const ALL_MOVES = Object.keys(MOVES) as MoveId[];
const NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * 素材视觉锚点（scripts/inkfx-anchors.ts 按 alpha 像素统计生成，重生成见 shared/fxAnchors.json）：
 * - ratio：原图高宽比
 * - cen：墨迹质心（画布百分比）——爆发/盾/中心技用它对齐角色或圆阵中心
 * - core：朱砂核心质心——弹道类用它骑在飞行路径上（核心领先）
 * - bbox：内容包围盒 [x0,y0,x1,y1]——光束类用它撑满 施法者→目标 距离
 */
const FX_ANCHORS: Record<MoveId, {
  ratio: number;
  cen: [number, number];
  core?: [number, number];
  bbox?: [number, number, number, number];
}> = {
  charge:       { ratio: 1, cen: [0.485, 0.624], core: [0.500, 0.636], bbox: [0.048, 0.110, 0.933, 0.894] },
  shield:       { ratio: 1, cen: [0.510, 0.500], core: [0.503, 0.189], bbox: [0.147, 0.171, 0.866, 0.834] },
  flyUp:        { ratio: 1.5, cen: [0.517, 0.643], bbox: [0.181, 0.083, 0.811, 0.971] },
  burrow:       { ratio: 0.667, cen: [0.507, 0.602], bbox: [0.011, 0.090, 0.993, 0.921] },
  shock:        { ratio: 0.667, cen: [0.423, 0.512], core: [0.423, 0.512], bbox: [0.134, 0.291, 0.893, 0.682] },
  hammerSky:    { ratio: 1.5, cen: [0.510, 0.564], core: [0.504, 0.202], bbox: [0.198, 0.038, 0.819, 0.999] },
  hammerGround: { ratio: 0.667, cen: [0.506, 0.630], core: [0.503, 0.595], bbox: [0.000, 0.145, 0.999, 0.993] },
  superShield:  { ratio: 1, cen: [0.504, 0.543], core: [0.519, 0.352], bbox: [0.033, 0.145, 0.975, 0.874] },
  superShock:   { ratio: 0.667, cen: [0.415, 0.487], core: [0.334, 0.500], bbox: [0.030, 0.248, 0.960, 0.680] },
  hammerBoth:   { ratio: 1, cen: [0.514, 0.467], core: [0.512, 0.647], bbox: [0.215, 0.000, 0.804, 0.999] },
  finger:       { ratio: 0.667, cen: [0.420, 0.510], core: [0.431, 0.504], bbox: [0.085, 0.350, 0.910, 0.665] },
  magicBurst:   { ratio: 1, cen: [0.498, 0.492], core: [0.505, 0.496], bbox: [0.035, 0.040, 0.956, 0.943] },
  voidRift:     { ratio: 1, cen: [0.422, 0.516], bbox: [0.018, 0.182, 0.975, 0.832] },
  ultimate:     { ratio: 0.667, cen: [0.552, 0.523], core: [0.309, 0.509], bbox: [0.001, 0.181, 0.999, 0.876] },
};

/** 演出用换算：素材包预览按 ~640px 短边调参，按舞台尺寸等比缩放 */
const tf = (scale = 1, rot = 0, tx = 0, ty = 0) =>
  `translate(-50%,-50%) translate(${tx}px,${ty}px) rotate(${rot}deg) scale(${scale})`;

export class Arena {
  private host!: HTMLElement;
  private wrap!: HTMLElement;
  private stage!: HTMLElement;
  private fxLayer!: HTMLElement;
  private tokensEl!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private darkOv!: HTMLElement;
  private flashOv!: HTMLElement;
  private hurtOv!: HTMLElement;
  private FX!: InkParticles;

  private seats = new Map<string, Seat>();
  /** 座次展示顺序（「我」排首位 → 正下方主视角位） */
  private order: string[] = [];
  private myId: string | undefined;        // 个人反馈用（被击震动/强闪）
  private lastHitSrc = new Map<string, string>();   // 受击来源（阵亡击退方向用；death 事件本身不带 src）
  private casts = new Map<string, CastSession>();   // 进行中的施法（被反制打断时回收飞行物）
  private W = 0;
  private H = 0;
  private u = 1;                    // 尺寸换算系数
  private tokScale = 1;             // 令牌缩放（人数越多越小）
  private playTimers = new Set<ReturnType<typeof setTimeout>>();     // playRound 排期的事件定时器（stopPlayback 掐断）
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private intervals = new Set<ReturnType<typeof setInterval>>();
  private bodyFx = new Set<Element>();       // 挂在 body 上的演出元素（招式横幅），destroy 时回收
  private stains = new Set<HTMLElement>();   // 阵亡墨渍（回合内残留）
  private seatCb: ((id: string) => void) | null = null;
  private ro: ResizeObserver | null = null;
  private destroyed = false;
  /** 减少动态（前庭安全）：关闭震屏/闪白/顿帧/镜头推挤 */
  private reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================= 初始化 ================= */

  async init(el: HTMLElement) {
    this.host = el;
    el.innerHTML = '';

    this.wrap = document.createElement('div');
    this.wrap.className = 'ink-stage-wrap';
    this.stage = document.createElement('div');
    this.stage.className = 'ink-stage';
    this.stage.innerHTML = `
      <div class="ink-ring"></div>
      <div class="ink-center-label">拍拍乐</div>
      <div class="ink-fx"></div>
      <div class="ink-tokens"></div>
      <canvas class="ink-canvas"></canvas>`;
    this.fxLayer = this.stage.querySelector('.ink-fx')!;
    this.tokensEl = this.stage.querySelector('.ink-tokens')!;
    this.canvas = this.stage.querySelector('.ink-canvas')!;
    this.darkOv = document.createElement('div');
    this.darkOv.className = 'ink-dark';
    this.flashOv = document.createElement('div');
    this.flashOv.className = 'ink-flash';
    this.hurtOv = document.createElement('div');
    this.hurtOv.className = 'ink-hurt';
    this.wrap.append(this.stage, this.darkOv, this.flashOv, this.hurtOv);
    el.appendChild(this.wrap);

    this.FX = new InkParticles(this.canvas);

    // 预载 14 招水墨特效（Webp 合计 ~5MB，进入斗法场即开始后台加载）
    for (const m of ALL_MOVES) {
      const img = new Image();
      img.src = fxUrl(m);
      img.decode().catch(() => {});
    }

    this.measure();
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(el);
  }

  private measure() {
    const r = this.host.getBoundingClientRect();
    this.W = r.width;
    this.H = r.height;
    this.u = Math.max(0.62, Math.min(Math.min(this.W, this.H) / 620, 1.7));
    this.FX.resize();
    this.layout();
  }

  destroy() {
    this.destroyed = true;
    for (const t of this.playTimers) clearTimeout(t);
    for (const t of this.timers) clearTimeout(t);
    for (const t of this.intervals) clearInterval(t);
    this.ro?.disconnect();
    this.FX?.destroy();
    for (const el of this.bodyFx) el.remove();
    this.bodyFx.clear();
    this.host.innerHTML = '';
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => { this.timers.delete(t); if (!this.destroyed) fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  /** 演出排期定时器：随 stopPlayback 一并掐断（20s 封顶/新回合/离场） */
  private playLater(fn: () => void, ms: number) {
    const t = this.later(() => { this.playTimers.delete(t); fn(); }, ms);
    this.playTimers.add(t);
    return t;
  }

  /** 受管 interval：到寿自清 + destroy 自清（飞行中离场不再泄漏定时器） */
  private every(fn: () => void, ms: number, lifeMs: number) {
    const t = setInterval(() => {
      if (this.destroyed) { clearInterval(t); this.intervals.delete(t); return; }
      fn();
    }, ms);
    this.intervals.add(t);
    this.later(() => { clearInterval(t); this.intervals.delete(t); }, lifeMs);
  }

  /** 移动端触觉反馈（Android 支持；iOS Safari 静默忽略）。只给自己相关的事件，避免全场震动轰炸 */
  private haptic(pattern: number | number[]) {
    try { navigator.vibrate?.(pattern); } catch { /* 不支持则忽略 */ }
  }

  /* ================= 座次 ================= */

  /** 同步玩家；myId 用于把「我」转到底部座次（狼人杀式主视角） */
  setPlayers(players: ArenaPlayer[], myId?: string) {
    this.myId = myId;
    const meIdx = myId ? players.findIndex((p) => p.id === myId) : -1;
    const ordered = meIdx > 0
      ? [...players.slice(meIdx), ...players.slice(0, meIdx)]
      : players;

    ordered.forEach((p, i) => {
      let seat = this.seats.get(p.id);
      if (!seat) seat = this.createSeat(p.id, p.name, players.indexOf(p) + 1);
      this.updateToken(seat, p, i === 0 && meIdx >= 0);
    });
    // 移除离场玩家（同步座次表）
    for (const [id, s] of this.seats) {
      if (!players.find((p) => p.id === id)) {
        s.el.remove();
        this.seats.delete(id);
      }
    }
    this.order = ordered.map((p) => p.id).filter((id) => this.seats.has(id));
    this.layout();
  }

  private createSeat(id: string, name: string, num: number): Seat {
    const el = document.createElement('div');
    el.className = 'itoken';
    el.innerHTML = `
      <span class="iseat">${num <= 9 ? NUMS[num - 1] : num}</span>
      <span class="badge"></span>
      <span class="tname">${escapeHtml(name)}</span>
      <span class="tinfo"><span class="hp-beads"></span><span class="tv"></span></span>`;
    // 先置于画外，等 layout() 定位后入场（避免首帧闪现在左上角）
    el.style.left = '-300px';
    el.style.top = '-300px';
    // 入场：按座次错峰落座（仅创建时一次；resize 重排不重播）
    if (!this.reduceMotion) {
      el.animate(
        [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
         { transform: 'translate(-50%,-50%) scale(1.08)', opacity: 1, offset: 0.7 },
         { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }],
        { duration: 340, delay: Math.min((num - 1) * 60, 520), easing: 'cubic-bezier(.2,.8,.3,1)' });
    }
    // 只允许可选目标触发出招（防止点自己/死者/无关令牌把已选招浪费在无效提交上）
    const activate = () => { if (el.classList.contains('selectable')) this.seatCb?.(id); };
    el.addEventListener('click', activate);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    this.tokensEl.appendChild(el);
    const seat: Seat = { id, num, name, el, x: 0, y: 0, flying: false, underground: false,
      shield: 0, shieldFxEl: null, stateFxEl: null, v: -1 };
    this.seats.set(id, seat);
    return seat;
  }

  private updateToken(seat: Seat, p: ArenaPlayer, isMe: boolean) {
    seat.el.classList.toggle('me', isMe);
    seat.el.classList.toggle('dead', !p.alive);
    seat.el.classList.toggle('picked', !!p.picked && p.alive);
    const beads = seat.el.querySelector('.hp-beads') as HTMLElement;
    const n = Math.max(0, Math.min(p.hp, 10));
    beads.textContent = '●'.repeat(n);
    // 高血量（≥7 珠）收紧字距/字号，防珠串把 V 数挤出令牌宽
    beads.style.letterSpacing = n >= 7 ? '0' : '';
    beads.style.fontSize = n >= 8 ? '0.82em' : '';
    const tv = seat.el.querySelector('.tv') as HTMLElement;
    tv.textContent = `V${p.v}`;
    if (seat.v !== p.v) {
      const changed = seat.v >= 0;   // 首次同步不脉冲
      seat.v = p.v;
      if (changed) tv.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.55)', offset: 0.3 }, { transform: 'scale(1)' }],
        { duration: 380, easing: 'ease-out' });
    }
    this.refreshBadge(seat);
  }

  private refreshBadge(seat: Seat) {
    const b = seat.el.querySelector('.badge') as HTMLElement;
    const tags: string[] = [];
    if (seat.flying) tags.push('飞天');
    if (seat.underground) tags.push('遁地');
    if (seat.shield === 1) tags.push('盾');
    if (seat.shield === 2) tags.push('超盾');
    b.textContent = tags.join('·');
    b.style.display = tags.length ? '' : 'none';
  }

  /** 椭圆座次环布局：我在正下方，其余顺时针排开（按 order 表而非 Map 插入序） */
  private layout() {
    const list = this.order.map((id) => this.seats.get(id)).filter((s): s is Seat => !!s);
    const n = list.length;
    if (!n || !this.W) return;
    // 令牌缩放：人数越多越小；窄屏（手机竖屏）额外缩放防 9 人满座重叠
    const narrow = this.W < 700;
    const base = n <= 4 ? 1 : n <= 6 ? 0.85 : 0.72;
    this.tokScale = narrow ? base * Math.max(0.55, this.W / 620) : base;
    this.tokensEl.style.setProperty('--tok', String(this.tokScale));
    const cx = this.W / 2, cy = this.H / 2;
    const rx = Math.min(this.W * (0.30 + Math.max(0, n - 5) * 0.022), this.W * 0.46);
    const ry = Math.min(this.H * (0.33 + Math.max(0, n - 5) * 0.018 + (narrow ? 0.06 : 0)), this.H * 0.46);
    list.forEach((p, i) => {
      const a = Math.PI / 2 + (i / n) * Math.PI * 2;
      p.x = cx + rx * Math.cos(a);
      p.y = cy + ry * Math.sin(a);
      p.el.style.left = p.x + 'px';
      p.el.style.top = p.y + 'px';
      if (p.shieldFxEl) {
        const mv = p.shield === 2 ? 'superShield' : 'shield';
        const w = (p.shield === 2 ? 190 : 165) * this.tokScale;
        const q = this.anchorCen(mv, p.x, p.y, w);
        p.shieldFxEl.style.left = q.x + 'px';
        p.shieldFxEl.style.top = q.y + 'px';
      }
      if (p.stateFxEl) {
        const w = (p.flying ? 200 : 240) * this.u;
        const q = this.anchorFeet(p.flying ? 'flyUp' : 'burrow', p.x, p.y + (p.flying ? 10 : 30), w);
        p.stateFxEl.style.left = q.x + 'px';
        p.stateFxEl.style.top = q.y + 'px';
      }
    });
  }

  /* ================= 选目标 ================= */

  onSeatClick(cb: (id: string) => void) {
    this.seatCb = cb;
  }

  highlightTargets(ids: string[]) {
    for (const [, s] of this.seats) {
      const on = ids.includes(s.id);
      s.el.classList.toggle('selectable', on);
      s.el.tabIndex = on ? 0 : -1;
      if (on) {
        s.el.setAttribute('role', 'button');
        s.el.setAttribute('aria-label', `选定 ${s.name} 为目标`);
      } else {
        s.el.removeAttribute('role');
        s.el.removeAttribute('aria-label');
      }
    }
  }

  /** 新回合：复位镜头、清空回合内状态（盾/飞天/遁地/墨渍） */
  resetRound() {
    this.stopPlayback();
    this.clearRoundStates();
    this.lastHitSrc.clear();
    this.casts.clear();   // 飞行物随 fxLayer 兜底清扫淡出,无需逐个 abort
  }

  /** 掐断事件链（20s 封顶对账/离场时用；不追杀已派发特效，让它们自然消散） */
  stopPlayback() {
    for (const t of this.playTimers) clearTimeout(t);
    this.playTimers.clear();
  }

  /** 反制/对冲打断：回收该施法者的飞行物并执行收场（如究极暗场复明） */
  private breakCast(pid: string) {
    const c = this.casts.get(pid);
    if (!c) return;
    this.casts.delete(pid);
    // 取消事件的排期（reveal+650ms）可能早于弹道 launch（superShock ≈660ms/究极 ≥1150ms）：
    // 此刻 flights 还是空集，必须立 broken 标记，让迟发的弹道/蓄力段在 launch 处自弃
    c.broken = true;
    for (const f of c.flights) f.abort();
    c.fizzle?.();
  }

  private clearRoundStates() {
    // 全屏覆盖层强制复位（播放被 20s 封顶掐断时,究极暗场/红晕的恢复定时器已随 playTimers 清空）
    for (const ov of [this.darkOv, this.flashOv, this.hurtOv]) {
      for (const a of ov.getAnimations()) a.cancel();
      ov.style.opacity = '0';
    }
    for (const el of this.stains) this.fadeRemove(el, 420);
    this.stains.clear();
    for (const [, s] of this.seats) {
      this.detachShieldFx(s, false);
      this.clearStateFx(s);
      s.flying = false;
      s.underground = false;
      s.shield = 0;
      // 平滑回落归位（WAAPI 单关键帧从当前值过渡）
      s.el.animate([{ transform: 'translate(-50%,-50%) translateY(0) scale(1)' }],
        { duration: 280, fill: 'forwards', easing: 'ease-out' });
      this.refreshBadge(s);
    }
    // 兜底清扫：播放被掐断（20s 封顶/离场重入）时残留的瞬态特效。
    // 常驻盾效/状态效在上面已 detach 并置空引用，此处剩下的都是无主瞬态图；
    // 单关键帧淡出=从当前透明度过渡到 0，不会把已半隐的图弹回全亮
    for (const el of [...this.fxLayer.children]) {
      if (el instanceof HTMLElement && el.tagName === 'IMG') {
        el.animate([{ opacity: 0 }], { duration: 240, fill: 'forwards' });
        this.later(() => el.remove(), 300);
      }
    }
  }

  /* ================= 演出原语 ================= */

  private spawnFx(img: string, x: number, y: number, w: number,
    frames: Keyframe[], dur: number, fill: FillMode = 'forwards') {
    const el = document.createElement('img');
    el.src = fxUrl(img);
    el.style.width = w + 'px';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.transform = tf();
    this.fxLayer.appendChild(el);
    const anim = el.animate(frames, { duration: dur, fill, easing: 'ease-out' });
    if (fill !== 'forwards') this.later(() => el.remove(), dur + 80);
    return el;
  }

  /** 震屏：正弦采样 + 平方衰减（game-feel 规范——平滑自熄，不用逐帧随机抖成静电） */
  private shake(amp = 6, dur = 350) {
    if (this.reduceMotion) return;
    const kf: Keyframe[] = [];
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const d = (1 - t) * (1 - t);   // trauma²：小震几乎不动，大震先猛后缓
      kf.push({
        transform: `translate(${Math.sin(t * 22 + 1.7) * amp * d}px,${Math.sin(t * 31 + 0.4) * amp * 0.7 * d}px) rotate(${Math.sin(t * 17) * 0.35 * d}deg)`,
      });
    }
    this.stage.animate(kf, { duration: dur, easing: 'linear' });
  }

  /** 镜头冲击缩放：大招时镜头猛推一下 */
  private zoomPunch(strength = 1.05, dur = 380) {
    if (this.reduceMotion) return;
    this.wrap.animate(
      [{ transform: 'scale(1)' }, { transform: `scale(${strength})`, offset: 0.25 }, { transform: 'scale(1)' }],
      { duration: dur, easing: 'ease-out' });
  }

  /** 顿帧：命中瞬间冻结本舞台内正在进行的动画，制造打击感（不波及页面其余 UI）。
   *  连续命中会叠加：深度计数归零才统一解冻，避免前一次的恢复提前放行后一次的冻结。
   *  恢复时注意：对「冻结前已结束」的动画要用 finish() 而非 play()——Chromium 里
   *  play() 会把已结束的 fill 动画从头重播（暗场/姿态/淡出全部闪回炉），finish() 才是跳回末尾保持 */
  private hitStopDepth = 0;
  private frozenAnims: { a: Animation; finished: boolean }[] = [];
  private hitStop(ms = 80) {
    if (this.reduceMotion) return;
    if (this.hitStopDepth++ === 0) {
      this.frozenAnims = document.getAnimations()
        .filter((a) => {
          const t = (a.effect as KeyframeEffect | null)?.target;
          return t instanceof Element && (this.wrap.contains(t) || this.bodyFx.has(t));
        })
        .map((a) => ({ a, finished: a.playState === 'finished' }));
      this.frozenAnims.forEach(({ a }) => a.pause());
    }
    this.FX.freeze(ms);
    this.later(() => {
      if (--this.hitStopDepth > 0) return;
      this.hitStopDepth = 0;
      for (const { a, finished } of this.frozenAnims) {
        if (finished) a.finish();
        else if (a.playState === 'paused') a.play();
      }
      this.frozenAnims = [];
    }, ms);
  }

  private flash(op = 0.85, dur = 120) {
    if (this.reduceMotion) return;
    this.flashOv.animate([{ opacity: op }, { opacity: 0 }], { duration: dur, fill: 'forwards' });
  }

  /** 受击红晕：重击时屏幕边缘洇开一圈朱砂（伤害的方向性感，比全屏白闪克制） */
  private hurtVignette(op = 0.5, dur = 420) {
    if (this.reduceMotion) return;
    this.hurtOv.animate([{ opacity: op }, { opacity: 0 }], { duration: dur, fill: 'forwards', easing: 'ease-out' });
  }

  private darkPeak = 0.82;   // 最近一次压暗的峰值（淡出必须从同一峰值起步,否则低峰值暗拍会被淡出先跳亮）
  private darken(on: boolean, dur = 300, peak = 0.82) {
    const p = on ? peak : this.darkPeak;
    if (on) this.darkPeak = peak;
    this.darkOv.animate([{ opacity: on ? 0 : p }, { opacity: on ? p : 0 }], { duration: dur, fill: 'forwards' });
  }

  private floatText(txt: string, x: number, y: number, cls = '', accent?: string) {
    const el = document.createElement('div');
    el.className = 'ifloat ' + cls;
    el.textContent = txt;
    el.style.left = x + 'px';
    el.style.top = (y - 46 * this.tokScale) + 'px';
    // 招式色彩读数（moves.ts 的 color 元数据激活点）：朱砂正文不变，只垫同色发丝底线 + 微光
    if (accent) {
      el.style.borderBottom = `2px solid ${rgba(accent, 0.85)}`;
      el.style.paddingBottom = '2px';
      el.style.textShadow = `0 1px 0 rgba(255,255,255,.85), 0 0 10px ${rgba(accent, 0.45)}`;
    }
    this.fxLayer.appendChild(el);
    el.animate(
      [{ transform: 'translate(-50%,0) scale(.6)', opacity: 0 },
       { transform: 'translate(-50%,-18px) scale(1.15)', opacity: 1, offset: 0.22 },
       { transform: 'translate(-50%,-24px) scale(1)', opacity: 1, offset: 0.35 },
       { transform: 'translate(-50%,-60px) scale(1)', opacity: 0 }],
      { duration: 1100, fill: 'forwards', easing: 'ease-out' });
    this.later(() => el.remove(), 1160);
  }

  /** 受击反馈：受击者闪白剪影 + 沿攻击方向击退抖动（受击者抖动幅度大于施法者） */
  private hitReact(seat: Seat, dirX = 0, power = 1) {
    const lift = seat.flying ? -46 * this.tokScale : seat.underground ? 26 * this.tokScale : 0;
    const scl = seat.underground ? 0.55 : 1;
    const base = (dx: number) => `translate(-50%,-50%) translateY(${lift}px) scale(${scl}) translateX(${dx}px)`;
    seat.el.animate([
      { transform: base(0), filter: 'brightness(1)' },
      { transform: base(dirX * 12 * power), filter: 'brightness(2.6) saturate(.35)', offset: 0.18 },
      { transform: base(dirX * -5 * power), filter: 'brightness(1.5)', offset: 0.5 },
      { transform: base(dirX * 3 * power), filter: 'brightness(1.1)', offset: 0.75 },
      { transform: base(0), filter: 'brightness(1)' },
    ], { duration: 420, easing: 'ease-out' });
  }

  /**
   * 2V/3V 神通题名 cut-in（国风美术字版）：斜扫墨带垫底（仅 2V）→ 榜书美术字整图砸入定格
   *  （落字一记轻錾 + 墨溅 + 墨光润泽）→ 名号小注浮出 → 整组淡出。
   *  2V 不抢演出（无太鼓无震屏，约 1.7s 自行退场）；3V 究极排面拉满（太鼓 + 白闪 + 速度线 + 震屏推镜）。
   */
  private titleCutIn(move: MoveId, caster: string | undefined, big: boolean, cutInMs: number) {
    const group = document.createElement('div');
    group.className = big ? 'ult-cutin' : 'skill-title';
    // 共享墨带仅垫 2V 题名；3V 究极美术字自带飞白长锋底衬，不再叠带
    let band: HTMLImageElement | null = null;
    if (!big) {
      band = document.createElement('img');
      band.src = titleUrl('inkband');
      band.className = 'title-band';
      band.alt = '';
      group.appendChild(band);
    }
    const word = document.createElement('img');
    word.src = titleUrl(move);
    word.className = big ? 'title-word big' : 'title-word';
    word.alt = MOVES[move].name;
    // 3V 字后衬一块宣纸「留白」聚光：暗场里把焦墨字托出来（黑底黑字不清的解法）
    let halo: HTMLDivElement | null = null;
    if (big) {
      halo = document.createElement('div');
      halo.className = 'title-halo';
      group.appendChild(halo);
    }
    const sub = document.createElement('div');
    sub.className = big ? 'ult-cutin-sub' : 'skill-title-sub';
    const subText = caster ? `${caster} · ${MOVES[move].flavor}` : MOVES[move].flavor;
    sub.textContent = big && subText.length > 16 ? `${caster} · 证道一击` : subText;
    group.append(word, sub);
    this.wrap.appendChild(group);
    this.bodyFx.add(group);

    // 墨带自左扫入——只留一道淡墨痕动势（浓带会吃掉黑字的对比度）
    band?.animate([
      { clipPath: 'inset(0 100% 0 0)', opacity: 0 },
      { clipPath: 'inset(-6% -2% -6% 0)', opacity: 0.3 },
    ], { duration: 140, fill: 'forwards', easing: 'ease-out' });

    // 美术字整图砸入：高空压下 → 回正定格，落字一瞬墨光润泽（fill:none 结束自然回落）
    const SLAM_AT = big ? 100 : 120, SLAM = 170;
    this.later(() => {
      halo?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards', easing: 'ease-out' });
      word.animate([
        { transform: 'rotate(-2.5deg) translateY(-26px) scale(2.05)', opacity: 0 },
        { transform: 'rotate(-2.5deg) translateY(0) scale(1)', opacity: 1 },
      ], { duration: SLAM, fill: 'forwards', easing: 'cubic-bezier(.2,.9,.2,1)' });
      word.animate([
        { filter: 'brightness(1.8) drop-shadow(0 0 14px rgba(255,196,150,0.55))' },
        { filter: 'none' },
      ], { duration: 190, fill: 'none', easing: 'ease-out' });
    }, SLAM_AT);

    // 落字定格：轻錾/太鼓 + 脚下墨溅墨环；3V 再补白闪、速度线、金火、震屏推镜
    const landAt = SLAM_AT + SLAM * 0.72;
    this.later(() => {
      const r = word.getBoundingClientRect();
      const w = this.wrap.getBoundingClientRect();
      const px = r.left + r.width / 2 - w.left, py = r.top + r.height * 0.78 - w.top;
      this.FX.burstInk(px, py, big ? 16 : 9, big ? 5.5 : 3);
      this.FX.ring(px, py, (big ? 120 : 70) * this.u, '40,36,32', 3.5);
      if (big) {
        sfx.drum();
        this.flash(0.3, 90);
        this.FX.burstStreaks(px, py, 18, 13);
        this.FX.burstSparks(px, py, 26, 9);
        this.shake(7, 280);
        this.zoomPunch(1.06, 260);
      } else {
        sfx.stamp(0);
      }
    }, Math.round(landAt));

    // 副题浮出
    this.later(() => {
      sub.animate([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 160, fill: 'forwards', easing: 'ease-out' });
    }, Math.round(landAt + 40));

    // 退场：整组淡出（只动 opacity，不碰定位 transform；later 保证对局掐断时也被清理）
    const exitAt = big ? cutInMs - 60 : 1350;
    this.later(() => {
      group.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: 220, fill: 'forwards', easing: 'ease-in' });
    }, exitAt);
    this.later(() => { group.remove(); this.bodyFx.delete(group); }, exitAt + 300);
  }

  /** 施法归属反馈：施法者脚下朱砂法环（DOM 双环，醒目）+ 令牌朱砂脉冲 + 墨流引向爆点 */
  private castMark(from: Seat, toX: number, toY: number) {
    const size = 118 * this.tokScale;
    const ring = document.createElement('img');
    ring.src = CAST_RING_SVG;
    ring.style.width = ring.style.height = size + 'px';
    ring.style.left = from.x + 'px';
    ring.style.top = from.y + 'px';
    ring.style.transform = 'translate(-50%,-50%)';
    this.fxLayer.appendChild(ring);
    ring.animate([
      { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.18)', opacity: 1, offset: 0.22 },
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.42 },
      { transform: 'translate(-50%,-50%) scale(1.14)', opacity: 0.85, offset: 0.72 },
      { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 0 },
    ], { duration: 900, fill: 'forwards', easing: 'ease-out' });
    this.later(() => ring.remove(), 960);
    // 施法者令牌朱砂脉冲
    from.el.animate([
      { boxShadow: '0 6px 16px rgba(0,0,0,0.25)' },
      { boxShadow: '0 0 0 10px rgba(178,34,34,0.6), 0 6px 16px rgba(0,0,0,0.25)', offset: 0.35 },
      { boxShadow: '0 0 0 22px rgba(178,34,34,0), 0 6px 16px rgba(0,0,0,0.25)' },
    ], { duration: 720, easing: 'ease-out' });
    this.FX.stream(from.x, from.y, toX, toY, 14);
  }

  /** 施法前摇：令牌挤压回弹 + 墨息 */
  private squashCast(seat: Seat) {
    seat.el.animate(
      [{ transform: 'translate(-50%,-50%) scale(1)' },
       { transform: 'translate(-50%,-50%) scale(0.82)', offset: 0.4 },
       { transform: 'translate(-50%,-50%) scale(1.08)', offset: 0.75 },
       { transform: 'translate(-50%,-50%) scale(1)' }],
      { duration: 300, easing: 'ease-out' });
    this.FX.puff(seat.x, seat.y + 20);
  }

  /** 弹道发射排期：让飞行恰好在其结算事件（hit/blocked/miss）时刻到达。
   *  理想飞行时长不变（930/1230 的呼吸感），窗口不够时压缩飞行而非提前到达。 */
  private flightSched(impactDelayMs: number | undefined, idealFlightMs: number): { delayMs: number; flightMs: number } {
    if (impactDelayMs === undefined) return { delayMs: 0, flightMs: idealFlightMs };
    const delayMs = Math.max(150, impactDelayMs - idealFlightMs);
    const flightMs = Math.min(idealFlightMs, Math.max(240, impactDelayMs - delayMs));
    return { delayMs, flightMs };
  }

  /** 单体招蓄势：出手窗口较远时，施法者脚下持续旋法环（保持「即将出手」的归属读数） */
  private castHold(seat: Seat, holdMs: number) {
    if (holdMs <= 700) return;
    const size = 104 * this.tokScale;
    const ring = document.createElement('img');
    ring.src = CAST_RING_SVG;
    ring.style.width = ring.style.height = size + 'px';
    ring.style.left = seat.x + 'px';
    ring.style.top = seat.y + 'px';
    ring.style.transform = 'translate(-50%,-50%)';
    this.fxLayer.appendChild(ring);
    ring.animate([
      { transform: 'translate(-50%,-50%) rotate(0deg) scale(1)', opacity: 0.55 },
      { transform: 'translate(-50%,-50%) rotate(120deg) scale(1.06)', opacity: 0.95 },
      { transform: 'translate(-50%,-50%) rotate(240deg) scale(1)', opacity: 0.55 },
    ], { duration: 1400, iterations: Math.ceil(holdMs / 1400), easing: 'ease-in-out' });
    this.playLater(() => this.fadeRemove(ring, 150), Math.max(0, holdMs - 120));
  }

  /** 把墨迹质心对齐到锚点（图片默认按画布中心定位，不等于视觉中心） */
  private anchorCen(move: MoveId, x: number, y: number, w: number) {
    const a = FX_ANCHORS[move];
    return {
      x: x + (0.5 - a.cen[0]) * w,
      y: y + (0.5 - a.cen[1]) * (w * a.ratio),
    };
  }

  /** 把内容底边对齐到地面点（脚下锚定：上天/下地） */
  private anchorFeet(move: MoveId, x: number, y: number, w: number) {
    const a = FX_ANCHORS[move];
    return {
      x: x + (0.5 - a.cen[0]) * w,
      y: y + (0.5 - (a.bbox?.[3] ?? 1)) * (w * a.ratio),
    };
  }

  /**
   * 通用三段式爆发（蓄力→爆发→消散）。去贴图感三件套：
   * ① 入场带微旋转甩入；② 保持期呼吸摆动（不是定住不动）；③ 叠一层 screen 混合 + 模糊的辉光复制体（红核能量外溢）
   */
  private playBoom(img: MoveId, x: number, y: number, w: number, holdMs = 350, peakScale = 1.06) {
    const p = this.anchorCen(img, x, y, w);
    const dur = 200 + holdMs + 500;
    const el = this.spawnFx(img, p.x, p.y, w, [
      { transform: tf(0.3, -7), opacity: 0 },
      { transform: tf(1.14, 4), opacity: 1, offset: 0.16 },
      { transform: tf(1.0, -2.5), opacity: 1, offset: 0.26 },
      { transform: tf(1.03, 2), opacity: 1, offset: 0.5 },
      { transform: tf(peakScale, -1, 0, -14), opacity: 1, offset: 0.78 },
      { transform: tf(peakScale * 1.05, 1, 0, -36), opacity: 0 },
    ], dur);
    // 辉光层：同图 screen 混合 + 高斯模糊 + 提饱和，随主体呼吸（墨色部分 screen 后不可见，红核金边发亮）
    const glow = this.spawnFx(img, p.x, p.y, w * 1.14, [
      { transform: tf(0.4, -7), opacity: 0 },
      { transform: tf(1.22, 4), opacity: 0.55, offset: 0.16 },
      { transform: tf(1.12, -2.5), opacity: 0.38, offset: 0.5 },
      { transform: tf(1.28, 1, 0, -34), opacity: 0 },
    ], dur - 40);
    glow.style.mixBlendMode = 'screen';
    glow.style.filter = 'blur(5px) saturate(1.35)';
    this.later(() => { el.remove(); glow.remove(); }, dur + 40);
  }

  /**
   * 弹道飞行：朱砂核心骑在路径上（核心领先飞行方向），拖尾粒子 + 轻微摆动。
   * durOverride 用于把到达时刻对齐结算事件（hit/blocked/miss）；
   * 返回句柄供反制/对冲打断（abort 时冻结当前位置 → 碎裂消散）。
   */
  private static readonly FLIGHT_MS: Partial<Record<MoveId, number>> = { shock: 1000, superShock: 1240 };

  private flyFx(img: MoveId, from: { x: number; y: number }, to: { x: number; y: number }, w: number,
    red = false, trailScale = 1, durOverride?: number): FlightHandle {
    const dx = to.x - from.x, dy = to.y - from.y;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const dist = Math.hypot(dx, dy);
    const dur = durOverride ?? Arena.FLIGHT_MS[img] ?? Math.max(260, dist / 1.6);
    // 核心在画布 core 处，居中定位后核心偏离路径点，需要常量平移把核心挪回路径上
    const a = FX_ANCHORS[img];
    const coreShiftX = (0.5 - (a.core?.[0] ?? 0.5)) * w;
    const coreShiftY = (0.5 - (a.core?.[1] ?? 0.5)) * (w * a.ratio);
    const el = document.createElement('img');
    el.src = fxUrl(img);
    el.style.width = w + 'px';
    el.style.left = from.x + 'px';
    el.style.top = from.y + 'px';
    this.fxLayer.appendChild(el);
    const steps = 6;
    const kf: Keyframe[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wob = Math.sin(t * Math.PI * 2) * 3;
      kf.push({
        transform: `translate(${dx * t}px,${dy * t}px) translate(-50%,-50%) rotate(${ang + 180 + wob}deg) translate(${coreShiftX}px,${coreShiftY}px)`,
        opacity: t === 0 ? 0.5 : 1,
      });
    }
    const t0 = performance.now();
    let curT = 0;        // 当前飞行进度（打断时按它冻结位置）
    let dead = false;
    const anim = el.animate(kf, { duration: dur, easing: 'cubic-bezier(.6,.05,.8,.4)', fill: 'forwards' });
    this.every(() => {
      if (dead) return;
      curT = Math.min(1, (performance.now() - t0) / dur);
      const sz = 1.15 - curT * 0.55;   // 起点粗、近终点细：拖尾粒径随飞行渐减，读出加速度
      this.FX.trail(from.x + dx * curT, from.y + dy * curT, red, sz);
      if (trailScale > 1.2) this.FX.trail(from.x + dx * curT + (Math.random() * 40 - 20), from.y + dy * curT + (Math.random() * 40 - 20), red, sz * 0.8);
    }, 16, dur + 80);
    // 残影：大招弹道身后挂两层递减透明度的复制体（延迟起跑，天然落后于本体）
    const ghosts: HTMLElement[] = [];
    if (trailScale > 1.2) {
      [0.32, 0.16].forEach((op, i) => {
        const g = document.createElement('img');
        g.src = fxUrl(img);
        g.style.width = w + 'px';
        g.style.left = from.x + 'px';
        g.style.top = from.y + 'px';
        g.style.opacity = String(op);
        g.style.filter = 'blur(2px)';
        this.fxLayer.appendChild(g);
        ghosts.push(g);
        g.animate(kf, { duration: dur, delay: 60 + i * 60, easing: 'cubic-bezier(.6,.05,.8,.4)', fill: 'forwards' });
        this.later(() => g.remove(), dur + 200 + i * 60);
      });
    }
    this.later(() => { dead = true; el.remove(); }, dur + 80);
    return {
      abort: () => {
        if (dead) return;
        dead = true;
        anim.cancel();
        // 冻结在被打断的当前位置，快速碎裂消散
        el.style.transform = `translate(${dx * curT}px,${dy * curT}px) translate(-50%,-50%) rotate(${ang + 180}deg) translate(${coreShiftX}px,${coreShiftY}px)`;
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
        this.later(() => el.remove(), 190);
        for (const g of ghosts) { for (const ga of g.getAnimations()) ga.cancel(); g.remove(); }
        const px = from.x + dx * curT, py = from.y + dy * curT;
        this.FX.burstInk(px, py, 12, 4);
        this.FX.burstSparks(px, py, 8, 4);
      },
    };
  }

  /** 命中爆点：墨爆素材小规模复用 + 粒子三连（k=目标视觉缩放：遁地为 0.55，爆点等比收小） */
  private hitBurst(x: number, y: number, big = false, k = 1) {
    this.playBoom('magicBurst', x, y, (big ? 300 : 170) * this.u * k, 80, 1.1);
    this.FX.burstInk(x, y, Math.round((big ? 34 : 18) * (0.6 + 0.4 * k)), (big ? 7 : 4.5) * k);
    this.FX.burstSparks(x, y, Math.round((big ? 22 : 10) * (0.6 + 0.4 * k)), (big ? 8 : 5) * k);
    if (big) this.FX.burstEmbers(x, y, 12, 4 * k);
    this.FX.ring(x, y, (big ? 200 : 110) * this.u * k);
  }

  /**
   * 令牌视觉锚点：结算反馈（爆点/飘字/粒子）必须对齐令牌「当前展示位」而非座次基础位。
   * 飞天令牌抬升 -46×tokScale、遁地下沉 +26×tokScale——tokScale 随座位数/窗口宽度变化
   * （9 人窄屏低至 ~0.4），用基础坐标会让爆点脱靶到令牌脚下。
   */
  private seatAnchor(seat: Seat): { x: number; y: number; k: number } {
    const lift = seat.flying ? -46 * this.tokScale : seat.underground ? 26 * this.tokScale : 0;
    return { x: seat.x, y: seat.y + lift, k: seat.underground ? 0.55 : 1 };
  }

  /* ================= 常驻状态特效 ================= */

  private attachShieldFx(seat: Seat) {
    this.detachShieldFx(seat, false);
    const move = seat.shield === 2 ? 'superShield' : 'shield';
    const w = (seat.shield === 2 ? 190 : 165) * this.tokScale;
    const p = this.anchorCen(move, seat.x, seat.y, w);
    const el = document.createElement('img');
    el.src = fxUrl(move);
    el.style.width = w + 'px';
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.style.transform = tf();
    this.fxLayer.appendChild(el);
    el.animate([{ transform: tf(1) }, { transform: tf(1.04) }, { transform: tf(1) }], { duration: 1600, iterations: Infinity });
    seat.shieldFxEl = el;
    this.FX.ring(seat.x, seat.y, (seat.shield === 2 ? 190 : 150) * this.tokScale, seat.shield === 2 ? '190,150,60' : '50,46,42');
    if (seat.shield === 2) this.FX.burstSparks(seat.x, seat.y, 20, 5);
  }

  /** 常驻特效退场：淡出后移除（onfinish 在动画被暂停/替换时不可靠，用定时器兜底） */
  private fadeRemove(el: HTMLElement, dur = 300) {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, fill: 'forwards' });
    this.later(() => el.remove(), dur + 60);
  }

  /**
   * 碎盾（自研特效，不用素材包成品图）：盾面按 clip-path 裂成 6 片墨片，
   * 各自旋飞散落 + 朱砂火星迸溅 + 墨滴 + 冲击环。穿透命中与格挡碎盾共用。
   */
  private shatterShieldFx(seat: Seat) {
    const move = seat.shield === 2 ? 'superShield' : 'shield';
    const w = (seat.shield === 2 ? 190 : 165) * this.tokScale;
    const p = this.anchorCen(move, seat.x, seat.y, w);
    // 六片碎墨：clip-path 切片区域 + 各自飞散方向/旋转（覆盖盾面全幅）
    const SHARDS: { poly: string; dx: number; dy: number; rot: number }[] = [
      { poly: 'polygon(0% 0%, 38% 0%, 22% 46%, 0% 34%)', dx: -70, dy: -62, rot: -40 },
      { poly: 'polygon(38% 0%, 78% 0%, 62% 38%, 22% 46%)', dx: 26, dy: -98, rot: 24 },
      { poly: 'polygon(78% 0%, 100% 0%, 100% 34%, 62% 38%)', dx: 88, dy: -48, rot: 52 },
      { poly: 'polygon(0% 34%, 22% 46%, 30% 80%, 0% 74%)', dx: -58, dy: 32, rot: 32 },
      { poly: 'polygon(62% 38%, 100% 34%, 92% 76%, 44% 72%)', dx: 72, dy: 58, rot: -36 },
      { poly: 'polygon(22% 46%, 62% 38%, 44% 72%, 30% 80%)', dx: 8, dy: 88, rot: 16 },
    ];
    for (const sh of SHARDS) {
      const el = document.createElement('img');
      el.src = fxUrl(move);
      el.style.width = w + 'px';
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.clipPath = sh.poly;
      el.style.transform = tf();
      this.fxLayer.appendChild(el);
      el.animate(
        [{ transform: tf(1), opacity: 1 },
         { transform: tf(1.22, sh.rot, sh.dx, sh.dy), opacity: 0 }],
        { duration: 560, delay: 50, fill: 'forwards', easing: 'cubic-bezier(.2,.55,.4,1)' });
      this.later(() => el.remove(), 680);
    }
    this.FX.burstSparks(seat.x, seat.y, 18, 6);
    this.FX.burstInk(seat.x, seat.y, 26, 6);
    this.FX.ring(seat.x, seat.y, 175 * this.tokScale);
    this.shake(6, 320);
  }

  /**
   * 格挡/抵消特效：弹道撞上盾面的一瞬——受击点定在朝攻击者的盾缘（nx/ny 为攻击来向单位向量）。
   * 盾面白热一闪（受击帧，与 hitStop 同拍冻结出「铛」的一顿）+ 朱砂新月两道斜掠 +
   * 金石双环（朱砂主环 + 金环迟半拍）+ 沿来向反溅的墨锥。
   * 「挡下」（超盾）与「挡碎」（普盾）共用此前奏，再各自接 盾震回弹 / 六片碎裂。
   */
  private parryFx(seat: Seat, nx: number, ny: number, big: boolean) {
    const move: MoveId = seat.shield === 2 ? 'superShield' : 'shield';
    const w = (seat.shield === 2 ? 190 : 165) * this.tokScale;
    const ix = seat.x - nx * w * 0.3;
    const iy = seat.y - ny * w * 0.3;
    const backAng = Math.atan2(-ny, -nx);   // 反溅锥朝攻击者泼回（劲力被弹回去）
    // ① 盾面白热一闪：盾图高亮复制体
    const p = this.anchorCen(move, seat.x, seat.y, w);
    const flash = document.createElement('img');
    flash.src = fxUrl(move);
    flash.style.width = w + 'px';
    flash.style.left = p.x + 'px';
    flash.style.top = p.y + 'px';
    flash.style.transform = tf();
    flash.style.filter = 'brightness(2.7) saturate(1.25)';
    this.fxLayer.appendChild(flash);
    flash.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 150, fill: 'forwards', easing: 'ease-out' });
    this.later(() => flash.remove(), 190);
    // ② 朱砂新月：受击点处两道由窄到宽的弧光，鼓面朝向攻击者
    const bulge = backAng * 180 / Math.PI + 45;
    for (const [d0, delay, dur] of [[110, 0, 140], [175, 50, 240]] as const) {
      const arc = document.createElement('div');
      arc.className = 'parry-arc';
      const sz = (big ? d0 * 1.25 : d0) * this.tokScale;
      arc.style.width = arc.style.height = sz + 'px';
      arc.style.left = ix + 'px';
      arc.style.top = iy + 'px';
      this.fxLayer.appendChild(arc);
      arc.animate([
        { transform: `translate(-50%,-50%) rotate(${bulge}deg) scale(.5)`, opacity: 0.95 },
        { transform: `translate(-50%,-50%) rotate(${bulge}deg) scale(1.15)`, opacity: 0 },
      ], { duration: dur, delay, fill: 'forwards', easing: 'ease-out' });
      this.later(() => arc.remove(), delay + dur + 60);
    }
    // ③ 金石双环 + 反溅墨锥/金火
    this.FX.ring(ix, iy, (big ? 190 : 140) * this.tokScale, '200,60,30');
    this.later(() => this.FX.ring(ix, iy, (big ? 130 : 95) * this.tokScale, '190,150,60', 3), 60);
    this.FX.burstInk(ix, iy, big ? 18 : 12, 5.5, backAng);
    this.FX.burstSparks(ix, iy, big ? 16 : 10, 5);
    if (big) this.FX.burstStreaks(ix, iy, 8, 8);
    // ④ 份量：轻顿帧 + 小震（格挡也要有打击感，只是比命中克制）
    this.hitStop(big ? 70 : 45);
    this.shake(big ? 5 : 3.5, 240);
  }

  /** 格挡受力：令牌沿攻击来向被顶退再回位（白闪让给盾面，人只被震退——比 hitReact 克制） */
  private guardKnock(seat: Seat, nx: number, ny: number, power = 1) {
    const lift = seat.flying ? -46 * this.tokScale : seat.underground ? 26 * this.tokScale : 0;
    const scl = seat.underground ? 0.55 : 1;
    const base = (dx: number, dy: number) =>
      `translate(-50%,-50%) translateY(${lift}px) scale(${scl}) translate(${dx}px,${dy}px)`;
    seat.el.animate([
      { transform: base(0, 0), filter: 'brightness(1)' },
      { transform: base(nx * 14 * power, ny * 10 * power), filter: 'brightness(1.35)', offset: 0.2 },
      { transform: base(-nx * 4 * power, -ny * 3 * power), filter: 'brightness(1.12)', offset: 0.55 },
      { transform: base(0, 0), filter: 'brightness(1)' },
    ], { duration: 380, easing: 'ease-out' });
  }

  private detachShieldFx(seat: Seat, shatter = false) {
    const el = seat.shieldFxEl;
    if (!el) return;
    seat.shieldFxEl = null;
    if (shatter) {
      this.FX.burstInk(seat.x, seat.y, 30, 6);
      this.FX.ring(seat.x, seat.y, 170 * this.tokScale);
      el.animate([{ transform: tf(1), opacity: 1 }, { transform: tf(1.5), opacity: 0 }], { duration: 400, fill: 'forwards' });
      this.later(() => el.remove(), 460);
    } else {
      this.fadeRemove(el);
    }
  }

  private clearStateFx(seat: Seat) {
    if (seat.stateFxEl) {
      this.fadeRemove(seat.stateFxEl);
      seat.stateFxEl = null;
    }
  }

  private applyStance(seat: Seat, up: boolean) {
    if (up && seat.flying) return;
    if (!up && seat.underground) return;
    if (up) { seat.flying = true; seat.underground = false; } else { seat.underground = true; seat.flying = false; }
    this.clearStateFx(seat);
    this.refreshBadge(seat);
    const k = this.tokScale;
    if (up) {
      for (let i = 0; i < 3; i++)
        this.later(() => this.FX.burstInk(seat.x, seat.y + 30, 8, 2.2, -Math.PI / 2), i * 90);
      const p = this.anchorFeet('flyUp', seat.x, seat.y + 10, 200 * this.u);
      seat.stateFxEl = this.spawnFx('flyUp', p.x, p.y, 200 * this.u, [
        { transform: tf(0.6, 0, 0, 40), opacity: 0 },
        { transform: tf(1, 0, 0, 0), opacity: 1 },
      ], 350);
      seat.el.animate(
        [{ transform: 'translate(-50%,-50%) translateY(0)' }, { transform: `translate(-50%,-50%) translateY(${-46 * k}px)` }],
        { duration: 350, fill: 'forwards' });
    } else {
      this.FX.burstInk(seat.x, seat.y + 30, 16, 3.5, Math.PI / 2);
      this.FX.ring(seat.x, seat.y + 30, 150 * this.u);
      const p = this.anchorFeet('burrow', seat.x, seat.y + 30, 240 * this.u);
      seat.stateFxEl = this.spawnFx('burrow', p.x, p.y, 240 * this.u, [
        { transform: tf(0.3), opacity: 0 },
        { transform: tf(1), opacity: 1 },
      ], 300);
      seat.el.animate(
        [{ transform: 'translate(-50%,-50%) translateY(0) scale(1)' }, { transform: `translate(-50%,-50%) translateY(${26 * k}px) scale(.55)` }],
        { duration: 350, fill: 'forwards', easing: 'ease-in' });
    }
  }

  /**
   * 锤系砸落演出：高空加速砸落（ease-in）→ 触地回弹 → 悬浮呼吸 → 上升消散。
   * 主体+辉光双层同帧运动；impactAt 在触地瞬间回调（衔接粒子编排）。
   */
  /** 锤系触地编排：双冲击环错开 + 速度线爆发帧 + 三波迸溅（墨块/金火/余烬）+ 白闪震屏顿帧 */
  private hammerImpact(x: number, y: number, big = false, dirBias: number | null = null) {
    sfx.hammer(big);
    this.FX.ring(x, y, (big ? 330 : 250) * this.u);
    this.later(() => this.FX.ring(x, y, (big ? 230 : 175) * this.u, '200,60,30'), 90);
    this.FX.burstStreaks(x, y, big ? 14 : 10, 10);
    this.FX.burstInk(x, y, big ? 32 : 22, 7.5, dirBias);
    this.FX.burstSparks(x, y, big ? 24 : 16, 8);
    this.later(() => { this.FX.burstInk(x, y, 15, 5.5, dirBias); this.FX.burstSparks(x, y, 12, 6.5); }, 110);
    this.later(() => this.FX.burstEmbers(x, y, big ? 15 : 9, 5.2), 210);
    this.flash(big ? 0.5 : 0.32, 130);
    this.shake(big ? 12 : 8, 480);
    this.hitStop(big ? 110 : 80);
    this.zoomPunch(big ? 1.06 : 1.04);
  }

  /**
   * 锤天（素材：冲天龙卷风暴）——单元素遮罩揭示版（无切片接缝）：
   * ① clip-path 自底向上"擦除揭示"长出（一个整图一个遮罩，不是五块纸条）
   * ② 保持期：柱身持续喷发上飘墨点 + 辉光呼吸 + 主图极轻微膨胀（≤2%，不整图晃）
   * ③ 顶端 climax：白剪影一闪 + 速度线冲击环（对天空的攻击落点）
   * ④ 非定向退场：整体淡出微升（不做第二段方向性运动）
   */
  private vortexErupt(x: number, yGround: number, eruptAt: () => void) {
    const move: MoveId = 'hammerSky';
    const a = FX_ANCHORS[move];
    const h = Math.max(240, Math.min(this.H * 0.62, yGround - 24, 560 * this.u));
    const w = h / a.ratio;
    const px = x + (0.5 - a.cen[0]) * w;
    const base = (s = 1, ty = 0) => `translate(-50%,-100%) translate(0px,${ty}px) scale(${s})`;
    const RISE = 450, HOLD = 750, FADE = 380;

    const mk = (isGlow: boolean) => {
      const el = document.createElement('img');
      el.src = fxUrl(move);
      el.style.width = (isGlow ? w * 1.1 : w) + 'px';
      el.style.left = px + 'px';
      el.style.top = yGround + 'px';
      el.style.transform = base();
      el.style.opacity = '0';
      el.style.clipPath = 'inset(100% 0 0 0)';
      if (isGlow) { el.style.mixBlendMode = 'screen'; el.style.filter = 'blur(10px) saturate(1.3)'; }
      this.fxLayer.appendChild(el);
      return el;
    };
    const el = mk(false);
    const glow = mk(true);

    // ① 自下而上揭开（遮罩从顶边收起 = 底部先显现），带 2% 膨胀的重量感
    el.animate([
      { clipPath: 'inset(100% 0 0 0)', opacity: 0.35, transform: base(1) },
      { clipPath: 'inset(0% 0 0 0)', opacity: 1, transform: base(1.02) },
    ], { duration: RISE, fill: 'forwards', easing: 'cubic-bezier(.3,.65,.35,1)' });
    glow.animate([
      { clipPath: 'inset(100% 0 0 0)', opacity: 0 },
      { clipPath: 'inset(0% 0 0 0)', opacity: 0.48 },
    ], { duration: RISE, fill: 'forwards', easing: 'ease-out' });

    // ② 保持期：主图极轻微呼吸 + 辉光明暗（不整图晃动）
    el.animate([{ transform: base(1.02) }, { transform: base(1.045) }, { transform: base(1.02) }],
      { duration: HOLD, delay: RISE, easing: 'ease-in-out' });
    glow.animate([{ opacity: 0.48 }, { opacity: 0.3 }, { opacity: 0.48 }],
      { duration: HOLD, delay: RISE, easing: 'ease-in-out' });

    // ③ 柱身持续上飘的墨点（动画感的主体来源之一）
    this.every(() => {
      const ty = yGround - h * (0.15 + Math.random() * 0.75);
      this.FX.burstInk(px + (Math.random() - 0.5) * w * 0.55, ty, 2, 1.4, -Math.PI / 2);
    }, 120, RISE + HOLD + FADE + 60);

    // ④ 顶端 climax + 非定向退场
    this.later(() => eruptAt(), RISE - 60);
    el.animate([
      { opacity: 1, transform: base(1.02) },
      { opacity: 0, transform: base(1.05, -24) },
    ], { duration: FADE, delay: RISE + HOLD, fill: 'forwards', easing: 'ease-in' });
    glow.animate([
      { opacity: 0.48 },
      { opacity: 0 },
    ], { duration: FADE, delay: RISE + HOLD, fill: 'forwards' });
    this.later(() => {
      el.remove();
      glow.remove();
    }, RISE + HOLD + FADE + 60);

    // climax 白剪影
    this.later(() => {
      const sil = mk(false);
      sil.style.clipPath = 'inset(0% 0 0 0)';
      sil.style.filter = 'brightness(6) contrast(1.4)';
      sil.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 95, fill: 'forwards' });
      this.later(() => sil.remove(), 130);
    }, RISE - 60);
  }

  /**
   * 锤地（素材：被锤烂的大地）——质心锚定贴地（不再悬空）：
   * 预警收缩环 → 裂地撕开（横向压扁瞬间弹开，白剪影一闪）→ 塌陷震颤余波 → 下沉消散
   */
  private groundShatter(x: number, yGround: number, w: number, shatterAt: () => void) {
    const move: MoveId = 'hammerGround';
    const p = this.anchorCen(move, x, yGround, w);
    const tfc = (sx: number, sy: number, rot: number, ty: number) =>
      `translate(-50%,-50%) translate(0px,${ty}px) rotate(${rot}deg) scale(${sx},${sy})`;
    const mk = (isGlow: boolean) => {
      const el = document.createElement('img');
      el.src = fxUrl(move);
      el.style.width = (isGlow ? w * 1.1 : w) + 'px';
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.transform = tfc(1.35, 0.18, 0, 12);
      el.style.opacity = '0';
      if (isGlow) { el.style.mixBlendMode = 'screen'; el.style.filter = 'blur(8px) saturate(1.3)'; }
      this.fxLayer.appendChild(el);
      return el;
    };
    // 预警：地面收缩环
    const warn = document.createElement('div');
    warn.className = 'ink-warn';
    warn.style.left = p.x + 'px';
    warn.style.top = p.y + 'px';
    this.fxLayer.appendChild(warn);
    warn.animate([
      { width: 260 * this.u + 'px', opacity: 0.85 },
      { width: 60 * this.u + 'px', opacity: 0 },
    ], { duration: 230, fill: 'forwards', easing: 'ease-in' });
    this.later(() => warn.remove(), 260);

    const el = mk(false);
    const glow = mk(true);
    const OPEN = 150;
    const kfOpen: Keyframe[] = [
      { transform: tfc(1.35, 0.18, 0, 12), opacity: 0 },
      { transform: tfc(1.04, 1.06, 1, -4), opacity: 1 },      // 裂纹瞬间撕开（轻微过冲）
    ];
    this.later(() => {
      el.animate(kfOpen, { duration: OPEN, fill: 'forwards', easing: 'cubic-bezier(.2,.9,.3,1)' });
      glow.animate(kfOpen, { duration: OPEN, fill: 'forwards', easing: 'cubic-bezier(.2,.9,.3,1)' });
    }, 240 - OPEN);
    this.later(() => {
      shatterAt();
      const sil = document.createElement('img');
      sil.src = fxUrl(move);
      sil.style.width = w + 'px';
      sil.style.left = p.x + 'px';
      sil.style.top = p.y + 'px';
      sil.style.transform = tfc(1.02, 1.0, 0, 0);
      sil.style.filter = 'brightness(6) contrast(1.4)';
      this.fxLayer.appendChild(sil);
      sil.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 95, fill: 'forwards' });
      this.later(() => sil.remove(), 130);
      // 震颤余波 → 下沉消散
      const kfD: Keyframe[] = [
        { transform: tfc(1.04, 1.06, 1, -4), opacity: 1 },
        { transform: tfc(1.0, 1.0, -1.5, 2), opacity: 1, offset: 0.18 },
        { transform: tfc(1.02, 0.99, 1.2, 0), opacity: 1, offset: 0.4 },
        { transform: tfc(1.0, 0.98, 0, 4), opacity: 1, offset: 0.62 },
        { transform: tfc(1.02, 0.94, 0, 16), opacity: 0 },
      ];
      el.animate(kfD, { duration: 760, fill: 'forwards', easing: 'ease-out' });
      glow.animate(kfD, { duration: 760, fill: 'forwards', easing: 'ease-out' });
      this.later(() => { el.remove(); glow.remove(); }, 820);
    }, 250);
  }

  /* ================= 招式演出（素材包三段式） ================= */

  /* ================= 招式演出（素材包三段式） ================= */

  /** 点播单招（演武场调试用）：默认仅施法段（命中反馈由事件流负责）；impact=true 时按弹道时长自演命中 */
  playMove(move: MoveId, fromId: string, toId?: string, impact = false) {
    const from = this.seats.get(fromId);
    if (!from) return;
    this.squashCast(from);
    if (MOVES[move].cost >= 2 && move !== 'ultimate') this.titleCutIn(move, this.seats.get(fromId)?.name, false, 0);
    const to = toId ? this.seats.get(toId) : undefined;
    const session: CastSession = { flights: new Set() };
    this.casts.set(fromId, session);
    let sched: CastSched | undefined;
    // 演武场单招点播的命中排期：究极给足排面窗口（cut-in + 蓄力 + 墨龙扫场），其余按弹道时长
    let demoImpactMs: number | undefined;
    if (impact && to) {
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const flightMs = move === 'finger' ? 260 : Arena.FLIGHT_MS[move] ?? Math.max(260, dist / 1.6);
      demoImpactMs = move === 'ultimate' ? Math.max(1700, flightMs)
        : move === 'finger' ? Math.max(950, flightMs)   // 一阳指束体需要窗口:凝指→贯通→光柱
        : flightMs;
      sched = { impactDelayMs: demoImpactMs, session };
    } else {
      sched = { session };
    }
    this.castFns[move]?.(from, to, sched);
    if (impact && to && demoImpactMs !== undefined) {
      this.playLater(() => this.playEvent({ type: 'hit', src: fromId, dst: toId!, move, lethal: false }, () => '?'), demoImpactMs);
    }
  }

  /**
   * 演武场专用：AOE 招式的简化规则结算（真实对局由服务端事件流驱动，不走这里）。
   * 究极：除超盾格挡外全部命中（普通盾被贯穿碎裂、飞天遁地照打）；锤系：只中对应状态者。
   */
  demoResolveAoe(move: MoveId, casterId: string) {
    const victims = [...this.seats.values()].filter((s) => s.id !== casterId);
    const hitAt = (dst: string, delay: number) =>
      this.later(() => this.playEvent({ type: 'hit', src: casterId, dst, move, lethal: false }, () => '?'), delay);
    const blockAt = (dst: string, delay: number) =>
      this.later(() => this.playEvent({ type: 'blocked', src: casterId, dst, move, by: 'superShield' }, () => '?'), delay);
    switch (move) {
      case 'ultimate':
        victims.forEach((s, i) => {
          const t = 1850 + i * 110;   // 墨龙贯穿路径上依次爆点（cut-in→蓄力→屏息→释放→大爆发之后）
          if (s.shield === 2) blockAt(s.id, t);
          else hitAt(s.id, t);        // 普通盾/飞天/遁地/无状态 → 命中（普通盾碎裂）
        });
        break;
      case 'hammerSky':
        victims.filter((s) => s.flying).forEach((s, i) => hitAt(s.id, 1100 + i * 130));
        break;
      case 'hammerGround':
        victims.filter((s) => s.underground).forEach((s, i) => hitAt(s.id, 1150 + i * 130));
        break;
      case 'hammerBoth':
        victims.filter((s) => s.flying || s.underground).forEach((s, i) => hitAt(s.id, 750 + i * 130));
        break;
      // 魔爆术/扭曲虚空是反制招，演武场无对方神通可反，无逐人结算
    }
  }

  private center() {
    return { x: this.W / 2, y: this.H / 2 };
  }

  private castFns: Record<MoveId, ((from: Seat, to?: Seat, sched?: CastSched) => void) | undefined> = {
    /* 爆V：墨雾旋转收缩 → 红核爆亮 → 金环扩散 + 余烬升腾 */
    charge: (from) => {
      sfx.chargeUp();
      this.FX.converge(from.x, from.y, 40, 170 * this.u);
      this.playBoom('charge', from.x, from.y, 240 * this.u, 500);
      this.FX.burstSparks(from.x, from.y, 16, 6);
      this.FX.burstEmbers(from.x, from.y, 9, 4);
      this.FX.ring(from.x, from.y, 150 * this.u, '190,150,60');
      this.flash(0.2, 120);
    },
    /* 普通盾：淡入呼吸，常驻至被击破 */
    shield: (from) => {
      sfx.shieldUp();
      from.shield = 1;
      this.attachShieldFx(from);
      this.refreshBadge(from);
    },
    /* 超级盾：金边更盛 */
    superShield: (from) => {
      sfx.shieldUp(true);
      from.shield = 2;
      this.attachShieldFx(from);
      this.refreshBadge(from);
      this.flash(0.25, 150);
    },
    /* 上天：墨息上升，令牌腾空 */
    flyUp: (from) => { sfx.flyUp(); this.applyStance(from, true); },
    /* 下地：墨渍扩散，令牌没入 */
    burrow: (from) => { sfx.burrow(); this.applyStance(from, false); },
    /* 普通冲击波：弹道延迟发射、恰在结算事件时刻到达（330u 起步——弹体过细读不出质量感） */
    shock: (from, to, sched) => {
      if (!to) return;
      sfx.zap();
      const s = this.flightSched(sched?.impactDelayMs, Arena.FLIGHT_MS.shock!);
      this.castHold(from, s.delayMs);
      this.playLater(() => {
        if (sched?.session?.broken) return;   // 已被反制：迟发弹道不再起飞
        const h = this.flyFx('shock', from, to, 330 * this.u, false, 1, s.flightMs);
        sched?.session?.flights.add(h);
      }, s.delayMs);
    },
    /* 超级冲击波：出手聚能一闪 → 朱砂弹道(残影拖尾)沿途绽冲击环 → 命中时刻到达 */
    superShock: (from, to, sched) => {
      if (!to) return;
      sfx.zap(true);
      const s = this.flightSched(sched?.impactDelayMs, Arena.FLIGHT_MS.superShock!);
      this.castHold(from, s.delayMs);
      this.FX.converge(from.x, from.y, 22, 110 * this.u);   // 出手聚能
      this.playLater(() => {
        if (sched?.session?.broken) return;   // 已被反制：迟发弹道不再起飞
        const h = this.flyFx('superShock', from, to, 380 * this.u, true, 1.5, s.flightMs);
        sched?.session?.flights.add(h);
        // 沿途朱砂冲击环：读出「贯穿而过」的压迫感（提速后环距收紧）
        const t0 = performance.now();
        this.every(() => {
          const t = Math.min(1, (performance.now() - t0) / s.flightMs);
          this.FX.ring(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 56 * this.u, '200,60,30', 2.5);
        }, 115, s.flightMs);
        this.flash(0.3, 120);
      }, s.delayMs);
    },
    /* 锤天（素材：冲天龙卷）：地面聚尘 → 遮罩揭示自地面拔起 → 顶端轰击天穹 */
    hammerSky: (from) => {
      const c = this.center();
      const baseY = c.y + this.H * 0.2;
      this.castMark(from, c.x, baseY);
      const topY = baseY - Math.max(240, Math.min(this.H * 0.62, baseY - 24, 560 * this.u));  // 龙卷顶端
      this.FX.converge(c.x, baseY, 18, 120 * this.u);
      this.vortexErupt(c.x, baseY, () => {
        this.hammerImpact(c.x, topY + 30, false, -Math.PI / 2);   // 爆点在龙卷顶端（轰击天穹处）
        this.FX.ring(c.x, baseY, 170 * this.u);                    // 基座尘环
        this.later(() => this.FX.burstSparks(c.x, topY + 60, 16, 8), 120);
      });
    },
    /* 锤地（素材：锤烂的大地）：预警收缩环 → 裂地轰然绽开 → 横向地浪 + 碎土迸溅 */
    hammerGround: (from) => {
      const c = this.center();
      const ix = c.x, iy = c.y + 85 * this.u;
      this.castMark(from, ix, iy);
      this.FX.converge(ix, iy, 16, 120 * this.u);
      this.groundShatter(c.x, c.y + 85 * this.u, 540 * this.u, () => {
        this.hammerImpact(ix, iy, false, Math.PI / 2);
        this.later(() => this.FX.ring(ix, iy, 420 * this.u, '40,36,32', 7), 130);
        this.later(() => this.FX.burstInk(ix - 120 * this.u, iy, 12, 6, 0), 160);
        this.later(() => this.FX.burstInk(ix + 120 * this.u, iy, 12, 6, Math.PI), 160);
      });
    },
    /* 锤天锤地：天地之力向中心压缩成一点 → 中心爆源迸发 → 天柱以爆点为原点向天/地同时激射展开
     *  （素材本身即「上天黑烟锤 + 中心爆核 + 下地火爆」的完整构图，整柱自中心一次展开：
     *   不裁半拼接——无中央接缝、无上下颠倒、蓄力期无压扁残条穿帮） */
    hammerBoth: (from) => {
      const c = this.center();
      this.castMark(from, c.x, c.y);
      const w = 320 * this.u;
      const p = this.anchorCen('hammerBoth', c.x, c.y, w);
      const CHARGE = 260, LAUNCH = 360, HOLD = 620, FADE = 380;
      // 蓄:天地之力向中心压缩成一点
      this.FX.converge(c.x, c.y, 30, 130 * this.u);
      // 迸发:中心爆源 + 天柱自爆点向天地两端激射（变换原点在柱心=爆点,scaleY 上下同步展开）
      const colTf = (sy: number, s = 1) => `translate(-50%,-50%) scale(${s}) scaleY(${sy})`;
      const DUR = LAUNCH + HOLD + FADE;
      const kfCol = (peak: number): Keyframe[] => [
        { transform: colTf(0.05, 0.9), opacity: 0 },
        { transform: colTf(1.07, 1.02), opacity: peak, offset: LAUNCH / DUR },
        { transform: colTf(1, 1), opacity: peak, offset: (LAUNCH + 90) / DUR },
        { transform: colTf(1.012, 1), opacity: peak * 0.95, offset: (LAUNCH + HOLD) / DUR },
        { transform: colTf(1.05, 1.01), opacity: 0 },
      ];
      this.later(() => {
        sfx.hammer(true);
        this.playBoom('hammerBoth', c.x, c.y, 190 * this.u, 180, 1.15);
        this.flash(0.4, 100);
        this.FX.ring(c.x, c.y, 150 * this.u);
        this.FX.burstSparks(c.x, c.y, 16, 7);
        // 迸发速度线:向天/向地两股
        this.FX.burstInk(c.x, c.y, 12, 9, -Math.PI / 2);
        this.FX.burstInk(c.x, c.y, 12, 9, Math.PI / 2);
        // 天柱主体 + 辉光复制体（screen 混合:墨色隐去,红核金边外溢）
        const col = this.spawnFx('hammerBoth', p.x, p.y, w, kfCol(1), DUR);
        const glow = this.spawnFx('hammerBoth', p.x, p.y, w * 1.12, kfCol(0.5), DUR);
        glow.style.mixBlendMode = 'screen';
        glow.style.filter = 'blur(7px) saturate(1.35)';
        this.later(() => { col.remove(); glow.remove(); }, DUR + 60);
      }, CHARGE);
      // 激射到位:天地合击拍
      this.later(() => {
        const ix = c.x, iy = c.y;
        this.FX.ring(ix, iy, 300 * this.u);
        this.later(() => this.FX.ring(ix, iy, 210 * this.u, '200,60,30'), 90);
        this.FX.burstInk(ix, iy, 26, 8.5, -Math.PI / 2);       // 墨浪冲天
        this.FX.burstInk(ix, iy, 26, 8.5, Math.PI / 2);        // 墨浪裂地
        this.FX.burstSparks(ix, iy, 20, 8);
        this.later(() => this.FX.burstEmbers(ix, iy, 15, 5.2), 180);
        this.flash(0.45, 110);
        this.shake(13, 520);
        this.hitStop(110);
        this.zoomPunch(1.07, 420);
        this.darken(true, 180, 0.45);
        this.later(() => this.darken(false, 380), 380);
      }, CHARGE + Math.round(LAUNCH * 0.72));
    },
    /* 一阳指（2V 排面）：凝指聚光 → 三层束体贯通（素材层 + 辉光层 + 束心热线）沿路金芒
     *  → 贯穿时刻:束心白热一涨 + 落点金光柱拔地 + 强化爆点；被扭曲虚空所破则中点碎断 */
    finger: (from, to, sched) => {
      if (!to) return;
      sfx.beam();
      const impactMs = sched?.impactDelayMs ?? 1400;
      const dx = to.x - from.x, dy = to.y - from.y;
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      const dist = Math.hypot(dx, dy);
      const a = FX_ANCHORS.finger;
      const span = (a.bbox![2] - a.bbox![0]) || 1;                 // 墨迹内容横向占比
      const w = dist / span;                                        // 内容实际覆盖 from→to
      const cenShift = (0.5 - (a.bbox![0] + a.bbox![2]) / 2) * w;   // 内容中点回正到连线中点
      // 凝指:指尖聚光 + 金芒微绽
      this.FX.converge(from.x, from.y, 18, 80 * this.u);
      this.FX.burstSparks(from.x, from.y, 8, 3);
      const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
      const beamTf = (sx: number) => `translate(${mx}px,${my}px) translate(-50%,-50%) rotate(${ang}deg) translate(${cenShift}px,0) scaleX(${sx})`;
      const beamFrom = `translate(${from.x}px,${from.y}px) translate(-50%,-50%) rotate(${ang}deg) translate(${cenShift}px,0) scaleX(0.02)`;
      const beamLife = Math.min(2800, impactMs + 240);
      const kfBeam: Keyframe[] = [
        { transform: beamFrom, opacity: 0 },
        { transform: beamTf(1), opacity: 1, offset: 0.2 },
        { transform: beamTf(1), opacity: 1, offset: Math.min(0.9, impactMs / beamLife * 0.85) },
        { transform: beamTf(1), opacity: 0.35, offset: 0.92 },
        { transform: beamTf(1), opacity: 0 },
      ];
      // ① 素材层（墨迹束体）
      const el = document.createElement('img');
      el.src = fxUrl('finger');
      el.style.width = w + 'px';
      this.fxLayer.appendChild(el);
      el.animate(kfBeam, { duration: beamLife, fill: 'forwards', easing: 'ease-out' });
      // ② 辉光层（同图 screen+模糊,随行呼吸）
      const glow = document.createElement('img');
      glow.src = fxUrl('finger');
      glow.style.width = w + 'px';
      glow.style.mixBlendMode = 'screen';
      glow.style.filter = 'blur(6px) saturate(1.35)';
      this.fxLayer.appendChild(glow);
      glow.animate(kfBeam.map((f) => ({ ...f, opacity: f.opacity === 1 ? 0.55 : f.opacity } as Keyframe)),
        { duration: beamLife, fill: 'forwards', easing: 'ease-out' });
      // ③ 束心热线（自施法者长出的炽白芯线）
      const coreLine = document.createElement('div');
      coreLine.className = 'beam-core';
      coreLine.style.left = from.x + 'px';
      coreLine.style.top = (from.y - 3.5) + 'px';
      coreLine.style.width = dist + 'px';
      coreLine.style.transformOrigin = '0 50%';
      coreLine.style.transform = `rotate(${ang}deg) scaleX(0)`;
      this.fxLayer.appendChild(coreLine);
      coreLine.animate([
        { transform: `rotate(${ang}deg) scaleX(0)`, opacity: 0 },
        { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 1 },
      ], { duration: beamLife * 0.22, delay: beamLife * 0.06, fill: 'forwards', easing: 'ease-out' });
      // 沿束金芒（加密:三粒一组）
      this.every(() => {
        if (sched?.session?.broken) return;   // 束体已被打断：金芒止息
        const tt = Math.random();
        this.FX.burstSparks(from.x + dx * tt, from.y + dy * tt, 3, 2.2);
      }, 30, beamLife);
      // 贯穿时刻:三层同时白热 + 落点金光柱拔地 + 强化爆点（被反制打断则不再播）
      this.playLater(() => {
        if (sched?.session?.broken) return;
        for (const t of [el, glow, coreLine]) {
          t.animate([
            { filter: 'brightness(1)' },
            { filter: 'brightness(3.2) saturate(1.3)' },
            { filter: 'brightness(1)' },
          ], { duration: 220, fill: 'none', easing: 'ease-out' });
        }
        // 落点跟随目标令牌当前视觉位（回调时实时读，含姿态偏移与布局变化）
        const a = this.seatAnchor(to);
        const pil = document.createElement('div');
        pil.className = 'beam-pillar';
        pil.style.left = a.x + 'px';
        pil.style.top = a.y + 'px';
        pil.style.height = 200 * this.u * a.k + 'px';
        pil.style.transformOrigin = '50% 100%';
        pil.style.transform = 'translate(-50%,-88%) scaleY(0)';
        this.fxLayer.appendChild(pil);
        pil.animate([
          { transform: 'translate(-50%,-88%) scaleY(0)', opacity: 0.95 },
          { transform: 'translate(-50%,-88%) scaleY(1)', opacity: 0.95 },
        ], { duration: 110, fill: 'forwards', easing: 'ease-out' });
        pil.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 300, delay: 150, fill: 'forwards', easing: 'ease-in' });
        this.later(() => pil.remove(), 520);
        this.FX.ring(a.x, a.y, 190 * this.u * a.k, '255,215,0', 3);
        this.FX.burstSparks(a.x, a.y, Math.round(18 * (0.6 + 0.4 * a.k)), 7 * a.k);
        this.FX.burstEmbers(a.x, a.y, 10, 4 * a.k);
      }, Math.max(0, impactMs - 30));
      this.later(() => { el.remove(); glow.remove(); coreLine.remove(); }, beamLife + 80);
      // 被破打断：三层束体中点碎裂消散
      sched?.session?.flights.add({
        abort: () => {
          for (const t of [el, glow, coreLine]) {
            for (const an of t.getAnimations()) an.cancel();
            t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 130, fill: 'forwards' });
          }
          this.later(() => { el.remove(); glow.remove(); coreLine.remove(); }, 170);
          this.FX.burstInk(mx, my, 12, 4);
          this.FX.burstSparks(mx, my, 10, 4);
        },
      });
    },
    /* 魔爆术：全场爆发，抹除冲击波——主爆 + 暗拍 + 二段余爆（魔气翻涌两浪,拍与拍拉开） */
    magicBurst: (from) => {
      sfx.burst();
      const c = this.center();
      this.castMark(from, c.x, c.y);
      this.FX.burstInk(c.x, c.y, 20, 3);
      this.playBoom('magicBurst', c.x, c.y, 640 * this.u, 620, 1.15);
      this.FX.burstInk(c.x, c.y, 60, 11);
      this.FX.burstSparks(c.x, c.y, 30, 10);
      this.FX.burstStreaks(c.x, c.y, 12, 11);
      this.FX.burstEmbers(c.x, c.y, 26, 6);
      this.FX.ring(c.x, c.y, 380 * this.u);
      this.FX.ring(c.x, c.y, 260 * this.u, '200,60,30');
      this.flash(0.55, 140);
      this.shake(10, 480);
      this.hitStop(100);
      this.zoomPunch(1.06);
      this.darken(true, 180, 0.4);
      this.later(() => this.darken(false, 360), 360);
      // 二段余爆：魔气翻涌的第二浪（与主爆拉开 340ms,两拍分明）
      this.later(() => {
        this.FX.ring(c.x, c.y, 300 * this.u, '200,60,30');
        this.FX.burstSparks(c.x, c.y, 16, 7);
        this.FX.burstEmbers(c.x, c.y, 14, 5);
        this.zoomPunch(1.04, 300);
      }, 340);
    },
    /* 扭曲虚空：引力暗晕+纯黑噬心（DOM,无贴图的"真虚空"）+ 双层裂隙反向不同速湍流
     *  （顺/逆双旋+不同焦距,消除"一张图在转"的贴图感）→ 闭合崩断一拍（塌缩进噬心） */
    voidRift: (from) => {
      sfx.vortex();
      const c = this.center();
      this.castMark(from, c.x, c.y);
      const w = 560 * this.u;
      const p = this.anchorCen('voidRift', c.x, c.y, w);
      const tfc = (s: number, rot: number) => `translate(-50%,-50%) rotate(${rot}deg) scale(${s})`;
      // 引力暗晕 + 噬心
      const halo = document.createElement('div');
      halo.className = 'void-halo';
      const hw = 640 * this.u;
      halo.style.width = halo.style.height = hw + 'px';
      halo.style.left = c.x + 'px';
      halo.style.top = c.y + 'px';
      halo.style.transform = 'translate(-50%,-50%)';
      this.fxLayer.appendChild(halo);
      const core = document.createElement('div');
      core.className = 'void-core';
      const cw = 210 * this.u;
      core.style.width = core.style.height = cw + 'px';
      core.style.left = c.x + 'px';
      core.style.top = c.y + 'px';
      core.style.transform = 'translate(-50%,-50%) scale(0.1)';
      this.fxLayer.appendChild(core);
      halo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, fill: 'forwards' });
      core.animate([
        { transform: 'translate(-50%,-50%) scale(0.1)' },
        { transform: 'translate(-50%,-50%) scale(1)' },
      ], { duration: 380, fill: 'forwards', easing: 'ease-out' });
      core.animate([
        { transform: 'translate(-50%,-50%) scale(1)' },
        { transform: 'translate(-50%,-50%) scale(1.12)' },
        { transform: 'translate(-50%,-50%) scale(1)' },
      ], { duration: 900, iterations: 3, easing: 'ease-in-out', delay: 380 });
      // 双层裂隙:顺/逆不同速、不同缩放与焦外,叠成湍流
      const mkRift = (scale: number, blur: number) => {
        const r = document.createElement('img');
        r.src = fxUrl('voidRift');
        r.style.width = w + 'px';
        r.style.left = p.x + 'px';
        r.style.top = p.y + 'px';
        r.style.transform = tfc(scale, 0);
        r.style.opacity = '0';
        r.style.filter = `blur(${blur}px)`;
        this.fxLayer.appendChild(r);
        return r;
      };
      const r1 = mkRift(1, 1);
      const r2 = mkRift(0.84, 5);
      r1.animate([{ opacity: 0 }, { opacity: 0.85 }], { duration: 400, fill: 'forwards', easing: 'ease-out' });
      r2.animate([{ opacity: 0 }, { opacity: 0.5 }], { duration: 500, fill: 'forwards', easing: 'ease-out' });
      r1.animate([{ transform: tfc(1, -20) }, { transform: tfc(1.05, 660) }], { duration: 2100, easing: 'linear' });
      r2.animate([{ transform: tfc(0.84, 40) }, { transform: tfc(0.98, -560) }], { duration: 2100, easing: 'linear' });
      this.FX.startVortex(c.x, c.y, 2200);
      this.darken(true, 500, 0.32);                     // 虚空在场:天地微微失色
      this.shake(5, 600);
      this.zoomPunch(1.03, 500);
      // 闭合崩断:双层塌缩进噬心 → 白闪一帧 + 合拢冲击环 + 复明
      this.later(() => {
        this.flash(0.22, 90);
        this.FX.ring(c.x, c.y, 260 * this.u, '200,60,30');
        this.FX.burstSparks(c.x, c.y, 14, 6);
        this.shake(6, 260);
        this.darken(false, 280);
        for (const el of [r1, r2, core]) for (const a of el.getAnimations()) a.cancel();
        for (const r of [r1, r2]) r.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
        core.animate([
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          { transform: 'translate(-50%,-50%) scale(0.05)', opacity: 1 },
          { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 },
        ], { duration: 260, fill: 'forwards', easing: 'ease-in' });
        halo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
        this.later(() => { for (const el of [r1, r2, core, halo]) el.remove(); }, 480);
      }, 2200);
    },
    /* 究极冲击波（3V 排面担当，奥拉星式五段）：大字斩入 cut-in → 持续蓄力升压 →
     *  静止屏息一拍 → 重磅释放墨龙贯穿 → 双闪大爆发定格 → 复明。
     *  全程以结算事件（首个命中/被破）为锚倒推编排。力量感的三个关键：
     *  蓄力段不安静（循环汇聚+低鸣+颤屏）、释放前 hitStop 屏息一拍、爆发双闪+长顿帧。 */
    ultimate: (from, _to, sched) => {
      sfx.ultimateCast();
      const c0 = this.center();
      this.castMark(from, c0.x, c0.y);
      this.darken(true, 350);
      const impactMs = sched?.impactDelayMs;
      const dx0 = c0.x - from.x, dy0 = c0.y - from.y;
      const d0 = Math.hypot(dx0, dy0) || 1;
      const dirx = dx0 / d0, diry = dy0 / d0;
      const ang = Math.atan2(dy0, dx0) * 180 / Math.PI;
      // 墨龙扫过全场：有锚时取窗口的 40%（封顶 900ms 的慢速巨物过境），无锚按屏距自定
      const flightMs = impactMs !== undefined
        ? Math.max(300, Math.min(900, impactMs * 0.4))
        : Math.max(300, Math.hypot(this.W, this.H) / 2.2);
      const fireAt = impactMs !== undefined ? Math.max(1150, impactMs - flightMs) : 1150;
      const boomAt = impactMs !== undefined ? impactMs : fireAt + flightMs;
      const cutIn = impactMs === undefined || impactMs >= 1000;

      // ① 究极专属 cut-in：大字逐字砸入 + 闷錾 + 太鼓（窗口过窄时跳过，保住弹道对齐）
      if (cutIn) this.titleCutIn('ultimate', from.name, true, 760);

      // ② 蓄力升压：cut-in 后循环汇聚墨流 + 低鸣上扬 + 颤屏渐强 + 墨核持续膨胀（张力累积）
      this.FX.converge(from.x, from.y, 60, 230 * this.u);
      const chargeStart = cutIn ? 1000 : 200;
      const chargeDur = Math.max(200, fireAt - 280 - chargeStart);
      this.playLater(() => {
        if (sched?.session?.broken) return;   // 已被魔爆所破：蓄力段整体作废
        sfx.chargeRise(Math.min(1.2, chargeDur / 1000 + 0.2));
        this.every(() => { if (sched?.session?.broken) return; this.FX.converge(from.x, from.y, 16, 150 * this.u); }, 220, chargeDur);
        this.every(() => { if (sched?.session?.broken) return; this.shake(2, 130); }, 320, chargeDur);
      }, chargeStart);
      const core = this.spawnFx('ultimate', from.x - dirx * 50, from.y - diry * 26, 280 * this.u, [
        { transform: tf(0.2, ang + 180), opacity: 0 },
        { transform: tf(0.75, ang + 180), opacity: 1 },
      ], Math.max(300, fireAt - 120));
      this.FX.emberStorm(Math.max(1600, boomAt + 600));

      // ③ 静止屏息：释放前一拍全场定格（墨核涨势与粒子全部冻结，白核一亮）——力量的呼吸口
      this.playLater(() => {
        if (sched?.session?.broken) return;
        this.hitStop(190);
        core.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(7) saturate(1.4)' }],
          { duration: 200, fill: 'forwards' });
        this.FX.ring(from.x - dirx * 50, from.y - diry * 26, 90 * this.u, '245,240,230');
      }, fireAt - 280);
      this.playLater(() => this.fadeRemove(core, 130), Math.max(200, fireAt - 140));

      // ④ 重磅释放：轰鸣 + 速度线大爆发 + 双冲击环 + 施法者后坐 + 墨龙拖残影扫场，飞行全程余震
      this.playLater(() => {
        if (sched?.session?.broken) return;   // 已被反制：墨龙不再出膛
        sfx.ultimateFire();
        sfx.zap(true);
        this.FX.burstStreaks(from.x, from.y, 22, 15);
        this.FX.ring(from.x, from.y, 240 * this.u);
        this.FX.burstSparks(from.x, from.y, 30, 9);
        this.FX.burstInk(from.x, from.y, 18, 6, -Math.PI / 2);
        this.zoomPunch(1.08, 350);
        from.el.animate([
          { transform: 'translate(-50%,-50%)' },
          { transform: `translate(-50%,-50%) translate(${(-dirx * 16).toFixed(1)}px,${(-diry * 10).toFixed(1)}px)` },
          { transform: 'translate(-50%,-50%)' },
        ], { duration: 300, easing: 'ease-out' });
        const c = this.center();
        const dx = c.x - from.x, dy = c.y - from.y;
        const d = Math.hypot(dx, dy) || 1;
        const end = { x: from.x + (dx / d) * (Math.hypot(this.W, this.H) + 400), y: from.y + (dy / d) * (Math.hypot(this.W, this.H) + 400) };
        const h = this.flyFx('ultimate', { x: from.x - dirx * 80, y: from.y - diry * 40 }, end, 700 * this.u, true, 2, flightMs);
        sched?.session?.flights.add(h);
        // 巨物过境:飞行全程持续低鸣颤屏(不是只在中段震一下)
        this.every(() => this.shake(3, 180), 200, flightMs);
      }, fireAt);

      // ⑤ 双闪大爆发：白闪两连 + 墨龙白剪影放大定格 + 纯墨迸溅 + 双冲击环 + 长顿帧强推镜（结算时刻）
      this.playLater(() => {
        if (sched?.session?.broken) return;
        sfx.ultimateHit();
        const c = this.center();
        this.flash(0.95, 180);
        this.later(() => this.flash(0.45, 140), 130);
        this.shake(18, 900);
        this.hitStop(170);
        this.zoomPunch(1.12, 550);
        this.FX.burstInk(c.x, c.y, 34, 8.5);
        this.FX.burstStreaks(c.x, c.y, 16, 12);
        this.FX.ring(c.x, c.y, 460 * this.u);
        this.later(() => this.FX.ring(c.x, c.y, 320 * this.u, '200,60,30'), 90);
        this.FX.burstEmbers(c.x, c.y, 30, 6);
        const sil = this.spawnFx('ultimate', c.x, c.y, 640 * this.u, [
          { transform: tf(1.2, ang + 180), opacity: 0.95 },
          { transform: tf(1.46, ang + 180), opacity: 0 },
        ], 240);
        sil.style.filter = 'brightness(6) contrast(1.4)';
        this.later(() => sil.remove(), 300);
      }, boomAt);
      this.playLater(() => this.darken(false, 420), boomAt + 1000);
      // 被魔爆术取消：cut-in 自然收场，暗场立即复明、余烬风暴止息、墨核熄灭（飞行物由 breakCast 碎裂）
      sched?.session && (sched.session.fizzle = () => {
        this.darken(false, 250);
        this.FX.emberStorm(0);
        this.fadeRemove(core, 160);
      });
    },
  };

  /* ================= 事件编排 ================= */

  /** 把一回合事件流映射到演出（按 shared/pacing 排拍）；onEvent 逐事件回调（供外层做事件驱动的状态同步）。
   *  反制打断重排：引擎把 cancel 排在全部 reveal 之后，照播会变成「招式演完了才说被破」。
   *  这里把每个 cancel 挪到其受害者 reveal 之后紧接着播出——先破招、后见反制者，打断感成立。
   *  只改播出顺序不改各事件节拍，总时长与 pacing 估算保持一致（服务端 showMs 不受影响）。
   *  弹道对齐：单体招与究极的结算事件（hit/blocked/miss）在事件流里位于全部 reveal 之后——
   *  若在 reveal 立即发射，弹道早已消散而爆点姗姗来迟。这里预排绝对时间表，
   *  把发射延迟到「恰在结算时刻到达」，被反制/对冲落败时弹道中途碎裂（见 flyFx.abort）。 */
  playRound(events: GameEvent[], nameOf: (id: string) => string, onEvent?: (ev: GameEvent) => void) {
    this.stopPlayback();
    const cancelOf = new Map<string, GameEvent>();
    const seq: GameEvent[] = [];
    for (const ev of events) {
      if (ev.type === 'cancel') cancelOf.set(ev.p, ev);
      else seq.push(ev);
    }
    // 绝对时间表（与服务端 showMs 同口径：各事件节拍之和）
    const slots: { ev: GameEvent; at: number }[] = [];
    let t = 0;
    for (const ev of seq) {
      slots.push({ ev, at: t });
      const pace = eventPaceMs(ev);
      const brk = ev.type === 'reveal' ? cancelOf.get(ev.p) : undefined;
      if (brk) {
        slots.push({ ev: brk, at: t + Math.min(pace, 650) });
        t += pace + eventPaceMs(brk);
        cancelOf.delete((ev as { p: string }).p);   // 演武场 showcase 同人多次 reveal：取消只随首次 reveal 播一次，防重复播报+时轴漂移
      } else {
        t += pace;
      }
    }
    // 单体招/究极的结算时刻（相对各自 reveal）：供弹道对齐
    const impactDelay = new Map<string, number>();
    const ALIGNED: MoveId[] = ['shock', 'superShock', 'finger', 'ultimate'];
    slots.forEach((s, i) => {
      if (s.ev.type !== 'reveal' || !ALIGNED.includes(s.ev.move)) return;
      let j = i + 1;
      for (; j < slots.length; j++) {
        const e = slots[j].ev;
        if ((e.type === 'hit' || e.type === 'blocked' || e.type === 'miss') && e.src === s.ev.p) break;
        if (e.type === 'cancel' && e.p === s.ev.p) break;
        if (e.type === 'clash' && (e.a === s.ev.p || e.b === s.ev.p)) {
          // 对冲胜者的命中事件在更后面——继续找它；落败/互抵则以对冲为终点（弹道被打断）
          if (e.winner === s.ev.p) {
            for (let k = j + 1; k < slots.length; k++) {
              const e2 = slots[k].ev;
              if ((e2.type === 'hit' || e2.type === 'blocked' || e2.type === 'miss') && e2.src === s.ev.p) { j = k; break; }
            }
          }
          break;
        }
      }
      if (j < slots.length) impactDelay.set(s.ev.p, Math.max(300, slots[j].at - s.at));
    });
    // 按时间表派发
    for (const s of slots) {
      const sched = s.ev.type === 'reveal' ? impactDelay.get(s.ev.p) : undefined;
      this.playLater(() => {
        if (this.destroyed) return;
        onEvent?.(s.ev);
        this.playEvent(s.ev, nameOf, sched);
      }, s.at);
    }
  }

  /** 阵亡墨渍：陨落者脚下残留一团洇开的死墨（回合结束淡出） */
  private addStain(seat: Seat) {
    const el = document.createElement('div');
    el.className = 'ink-stain';
    const s = (86 + Math.random() * 26) * this.tokScale;
    const rot = Math.round(Math.random() * 360);
    el.style.width = s + 'px';
    el.style.height = s * 0.78 + 'px';
    el.style.left = seat.x + 'px';
    el.style.top = seat.y + 'px';
    el.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;
    this.fxLayer.appendChild(el);
    el.animate(
      [{ transform: `translate(-50%,-50%) rotate(${rot}deg) scale(.25)`, opacity: 0 },
       { transform: `translate(-50%,-50%) rotate(${rot}deg) scale(1)`, opacity: 1 }],
      { duration: 560, delay: 220, fill: 'forwards', easing: 'cubic-bezier(.2,.8,.3,1)' });
    this.stains.add(el);
  }

  private playEvent(ev: GameEvent, nameOf: (id: string) => string, impactDelayMs?: number) {
    switch (ev.type) {
      case 'reveal': {
        const from = this.seats.get(ev.p);
        if (!from) break;
        this.squashCast(from);
        // 究极走 big 档题名（太鼓+震屏排面），其余 2V 走轻量档
        if (MOVES[ev.move].cost >= 2 && ev.move !== 'ultimate') this.titleCutIn(ev.move, nameOf(ev.p), false, 0);
        const session: CastSession = { flights: new Set() };
        this.casts.set(ev.p, session);
        this.castFns[ev.move]?.(from, ev.target ? this.seats.get(ev.target) : undefined, { impactDelayMs, session });
        break;
      }
      case 'vChange': {
        const s = this.seats.get(ev.p);
        if (!s) break;
        if (ev.delta > 0) {
          sfx.vGain();
          this.floatText(`+${ev.delta}V`, s.x, s.y, 'vgo');
        } else {
          // 扣费飘字：让「神通是要花钱的」在演出层可读（上方 +V 下方 −V 不打架）
          this.floatText(`−${-ev.delta}V`, s.x, s.y + 14 * this.tokScale, 'vspend');
        }
        break;
      }
      case 'stance': {
        const s = this.seats.get(ev.p);
        if (s) this.applyStance(s, ev.move === 'flyUp');
        break;
      }
      case 'hit': {
        const s = this.seats.get(ev.dst);
        if (!s) break;
        const srcSeat = this.seats.get(ev.src);
        this.lastHitSrc.set(ev.dst, ev.src);
        const dirX = srcSeat ? (Math.sign(s.x - srcSeat.x) || 1) : 0;
        const big = ev.lethal || MOVES[ev.move].cost >= 2;
        const a = this.seatAnchor(s);   // 爆点/飘字对齐令牌展示位（飞天抬升/遁地下沉）
        sfx.hit(big);
        if (s.shield > 0) {
          // 能穿过盾落地必是穿透（一阳指/超级冲击波…）：自研碎盾贯穿演出
          this.shatterShieldFx(s);
          this.detachShieldFx(s, false);
          s.shield = 0;
          this.refreshBadge(s);
          this.floatText('碎盾·命中', a.x, a.y, '', MOVES[ev.move].color);
        } else {
          this.hitBurst(a.x, a.y, big, a.k);
          this.floatText('命中', a.x, a.y, '', MOVES[ev.move].color);
        }
        if (big) this.FX.burstStreaks(a.x, a.y, 10, 10);
        this.hitReact(s, dirX, big ? 1.25 : 1);
        this.shake(big ? 8 : 5, big ? 400 : 300);
        this.hitStop(big ? 90 : 60);
        if (big) { this.zoomPunch(1.04); this.hurtVignette(0.42, 460); }
        // 自己挨打要格外「疼」一下：强闪 + 触觉震动（移动端）
        if (ev.dst === this.myId) {
          this.flash(big ? 0.5 : 0.32, 180);
          this.hurtVignette(big ? 0.75 : 0.5, 520);
          this.haptic(big ? [40, 40, 60] : 25);
        }
        break;
      }
      case 'blocked': {
        const s = this.seats.get(ev.dst);
        if (!s) break;
        const srcSeat = this.seats.get(ev.src);
        // 攻击来向（src→dst 单位向量）：受击点/盾震方向/反溅锥都以它定向（无 src 座位时以场心为攻击方）
        const dx = s.x - (srcSeat?.x ?? this.W / 2);
        const dy = s.y - (srcSeat?.y ?? this.H / 2);
        const dd = Math.hypot(dx, dy) || 1;
        const nx = dx / dd, ny = dy / dd;
        const big = MOVES[ev.move].cost >= 2;
        this.guardKnock(s, nx, ny, big ? 1.15 : 0.9);
        this.parryFx(s, nx, ny, big);
        if (ev.by === 'shield') {
          // 普盾挡下一次攻击即碎：金石一挡 → 盾身碎裂，两拍分明
          sfx.blocked();
          this.floatText('盾碎·格挡', s.x, s.y, 'block', MOVES[ev.move].color);
          this.later(() => { sfx.shatter(); this.shatterShieldFx(s); }, 70);
          this.detachShieldFx(s, false);
          s.shield = 0;
          this.refreshBadge(s);
        } else {
          // 超盾稳稳接下：盾体沿来向被顶退、再带过冲弹回（吃了一记重的，但没破）
          sfx.blocked(big);
          this.floatText('格挡', s.x, s.y, 'block', MOVES[ev.move].color);
          const k = big ? 1.25 : 1;
          s.shieldFxEl?.animate([
            { transform: tf(1) },
            { transform: tf(0.95, 0, nx * 15 * k, ny * 11 * k), offset: 0.22 },
            { transform: tf(1.03, 0, -nx * 5 * k, -ny * 4 * k), offset: 0.55 },
            { transform: tf(1) },
          ], { duration: 340, easing: 'ease-out' });
          if (ev.dst === this.myId) this.haptic(big ? [18, 24, 18] : 15);
        }
        break;
      }
      case 'miss': {
        const s = this.seats.get(ev.dst);
        if (s) {
          sfx.miss();
          const a = this.seatAnchor(s);
          this.floatText('闪避', a.x, a.y, 'dodge', MOVES[ev.move].color);
          this.FX.puff(a.x, a.y - 20);
        }
        break;
      }
      case 'cancel': {
        const s = this.seats.get(ev.p);
        if (s) {
          sfx.cancelBuzz();
          this.floatText('神通被破', s.x, s.y, 'cancel');
          this.FX.burstInk(s.x, s.y, 14, 3);
        }
        this.breakCast(ev.p);   // 飞行中的弹道/光束当场碎裂（究极暗场复明）
        break;
      }
      case 'clash': {
        const c = this.center();
        const a = this.seats.get(ev.a);
        const b = this.seats.get(ev.b);
        sfx.clash();
        this.hitBurst(c.x, c.y, true);
        this.floatText(ev.winner ? '对冲·压制' : '对冲·两败俱伤', c.x, c.y, 'clash');
        // 对冲双方各自被对方劲力震开（互指时两令牌相向弹开）
        if (a && b) {
          this.hitReact(a, Math.sign(a.x - b.x) || 1, 0.8);
          this.hitReact(b, Math.sign(b.x - a.x) || 1, 0.8);
        }
        // 落败方（或互抵双方）的弹道在对冲点被震碎；胜者的神通继续飞向目标
        if (ev.winner !== ev.a) this.breakCast(ev.a);
        if (ev.winner !== ev.b) this.breakCast(ev.b);
        this.shake(8, 400);
        break;
      }
      case 'death': {
        const s = this.seats.get(ev.p);
        if (!s) break;
        const srcSeat = this.seats.get(this.lastHitSrc.get(ev.p) ?? '');
        const a = this.seatAnchor(s);   // 空中陨落（锤天/锤天锤地/究极击杀飞天者）爆点跟随令牌
        sfx.death();
        this.hitBurst(a.x, a.y, true, a.k);
        this.FX.burstInk(a.x, a.y, 44, 9);
        this.FX.burstStreaks(a.x, a.y, 12, 11);
        this.hitReact(s, srcSeat ? (Math.sign(s.x - srcSeat.x) || 1) : 0, 1.6);
        this.floatText(`${nameOf(ev.p)} 陨落`, a.x, a.y, 'dead');
        this.flash(0.5, 160);
        this.shake(12, 600);
        this.hitStop(150);
        this.addStain(s);               // 尸渍留在地面原位（身死落地）
        s.el.classList.add('dead');
        if (ev.p === this.myId) this.haptic([80, 60, 120]);
        break;
      }
      case 'roundEnd':
        this.clearRoundStates();
        break;
    }
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** #rrggbb → rgba()（飘字招式色微光用，色彩以 moves.ts 元数据为准） */
function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
