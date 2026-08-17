import gsap from 'gsap';
import { MOVES } from '@shared/moves';
import type { GameEvent } from '@shared/types';

/** 播放器卡片的 DOM 选择器锚点 */
const cardOf = (pid: string) => document.querySelector<HTMLElement>(`[data-pid="${pid}"]`);
const appEl = () => document.getElementById('app');

/** 屏幕震动（按强度分级） */
export function shake(strength: 1 | 2 | 3 = 1) {
  const el = appEl();
  if (!el) return;
  const amp = [6, 12, 20][strength - 1];
  const tl = gsap.timeline();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const decay = 1 - i / n;
    tl.to(el, {
      x: (Math.random() * 2 - 1) * amp * decay,
      y: (Math.random() * 2 - 1) * amp * 0.7 * decay,
      duration: 0.05,
      ease: 'none',
    });
  }
  tl.to(el, { x: 0, y: 0, duration: 0.08 });
}

/** hit-stop：命中瞬间全局冻结（演出节奏靠 GSAP 时间轴，不靠冻结页面，这里只做视觉顿感） */
function hitStop(ms: number) {
  gsap.globalTimeline.timeScale(0.25);
  gsap.delayedCall(ms / 1000, () => gsap.globalTimeline.timeScale(1));
}

/** 伤害飘字：在目标卡位置弹起后消散 */
function floatDamage(pid: string, text: string, color = 'var(--red)') {
  const card = cardOf(pid);
  if (!card) return;
  const r = card.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'dmg-float';
  el.textContent = text;
  el.style.color = color;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top}px`;
  document.body.appendChild(el);
  gsap.fromTo(el,
    { xPercent: -50, y: 0, opacity: 1, scale: 0.6 },
    { xPercent: -50, y: -70, opacity: 0, scale: 1.15, duration: 0.9, ease: 'power2.out', onComplete: () => el.remove() },
  );
}

/** 招式横幅：中央大字定格（书法体 + 主题色辉光） */
function banner(text: string, color: string, sub?: string) {
  const el = document.createElement('div');
  el.className = 'cine-banner';
  el.style.color = color;
  el.innerHTML = text + (sub ? `<div style="font-size:20px;letter-spacing:6px;margin-top:6px;color:var(--text-2)">${sub}</div>` : '');
  document.body.appendChild(el);
  gsap.timeline({ onComplete: () => el.remove() })
    .fromTo(el, { opacity: 0, scale: 1.4, y: 10 }, { opacity: 1, scale: 1, y: 0, duration: 0.25, ease: 'back.out(2)' })
    .to(el, { opacity: 1, scale: 1, duration: 0.5 })
    .to(el, { opacity: 0, scale: 0.9, y: -14, duration: 0.3, ease: 'power2.in' });
}

/** 单卡受击反馈：闪白 + 击退抖动 */
function hitCard(pid: string, lethal: boolean) {
  const card = cardOf(pid);
  if (!card) return;
  gsap.timeline()
    .to(card, { filter: 'brightness(2.4)', duration: 0.06 })
    .to(card, { filter: 'brightness(1)', duration: 0.18 })
    .fromTo(card, { x: 0 }, { x: -7, duration: 0.05, repeat: 3, yoyo: true }, 0);
  if (lethal) {
    gsap.to(card, { filter: 'grayscale(1)', opacity: 0.3, scale: 0.92, duration: 0.5, delay: 0.3 });
  }
}

/** 格挡反馈：盾牌卡金色涟漪 */
function blockCard(pid: string) {
  const card = cardOf(pid);
  if (!card) return;
  gsap.timeline()
    .to(card, { boxShadow: '0 0 0 3px rgba(255,224,130,.9), 0 0 26px rgba(255,224,130,.8)', duration: 0.12 })
    .to(card, { boxShadow: '0 0 0 0 rgba(255,224,130,0)', duration: 0.45 });
}

/**
 * 战斗演出编排器：把一回合的事件流编排成 GSAP 时间轴。
 * 由 GameView 在收到 round:result 后调用。
 */
export function choreograph(events: GameEvent[], onDone?: () => void) {
  const tl = gsap.timeline({ onComplete: onDone });
  const byMove = (pid: string, move: keyof typeof MOVES) => MOVES[move].color;

  for (const ev of events) {
    switch (ev.type) {
      case 'reveal': {
        const def = MOVES[ev.move];
        const card = cardOf(ev.p);
        if (card) {
          tl.to(card, { scale: 1.12, duration: 0.18, ease: 'back.out(3)' })
            .to(card, { scale: 1, duration: 0.3, ease: 'power2.out' });
        }
        // 高消耗招才有大横幅（避免免费招刷屏）
        if (def.cost >= 2) tl.call(() => banner(`【${def.name}】`, def.color, def.flavor));
        break;
      }
      case 'vChange': {
        if (ev.delta > 0) tl.call(() => {
          const card = cardOf(ev.p);
          if (card) gsap.fromTo(card, { boxShadow: `0 0 0 0 rgba(255,213,74,.8)` }, { boxShadow: '0 0 24px 4px rgba(255,213,74,0)', duration: 0.7 });
          floatDamage(ev.p, '+1V', 'var(--gold)');
        });
        break;
      }
      case 'stance': {
        const card = cardOf(ev.p);
        if (card) {
          tl.to(card, {
            y: ev.move === 'flyUp' ? -22 : 14,
            opacity: ev.move === 'flyUp' ? 1 : 0.55,
            duration: 0.35, ease: 'power2.out',
          }).to(card, { y: 0, opacity: 1, duration: 0.3 }, '+=0.35');
        }
        break;
      }
      case 'cancel': {
        const color = ev.by === 'magicBurst' ? MOVES.magicBurst.color : MOVES.voidRift.color;
        tl.call(() => {
          banner(ev.by === 'magicBurst' ? '魔爆术·破' : '扭曲虚空·噬', color);
          const card = cardOf(ev.p);
          if (card) gsap.fromTo(card, { x: -4 }, { x: 4, duration: 0.05, repeat: 5, yoyo: true, clearProps: 'x' });
        });
        break;
      }
      case 'clash': {
        tl.call(() => {
          banner('对冲！', 'var(--purple)', ev.winner ? '强者压制' : '两败俱伤');
          shake(2);
        });
        break;
      }
      case 'hit': {
        const color = byMove(ev.src, ev.move);
        tl.call(() => {
          hitCard(ev.dst, ev.lethal);
          floatDamage(ev.dst, ev.lethal ? '致命一击' : '-1', color);
          shake(ev.lethal ? 3 : 2);
          hitStop(ev.lethal ? 120 : 70);
        });
        tl.to({}, { duration: 0.18 }); // 事件间留白，让 hit-stop 有体感
        break;
      }
      case 'blocked': {
        tl.call(() => { blockCard(ev.dst); shake(1); });
        break;
      }
      case 'miss': {
        tl.call(() => {
          const card = cardOf(ev.dst);
          if (card) gsap.fromTo(card, { opacity: 0.4 }, { opacity: 1, duration: 0.4 });
        });
        break;
      }
      case 'death': {
        tl.call(() => {
          banner('身死道消', 'var(--red)');
          shake(3);
        });
        break;
      }
      default:
        break;
    }
  }
  // 保底：演出结束兜底回调（防止事件为空时 onDone 不触发）
  tl.call(() => onDone?.());
  return tl;
}
