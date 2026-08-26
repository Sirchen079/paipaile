/**
 * 水墨粒子引擎（移植自素材包预览页 particles.js，按米白宣纸底色调参）
 * 墨滴迸溅 / 金火星点 / 朱红余烬 / 冲击环 / 环境墨尘 / 涡旋吸入 / 余烬风暴
 * 全部绘制在同一张 2D canvas 上，随斗法场尺寸自适应。
 */

interface Particle {
  type: 'ink' | 'spark' | 'ember' | 'mote' | 'streak';
  x: number; y: number; vx: number; vy: number;
  g: number; drag: number; life: number; max: number; size: number;
  rot?: number; spin?: number; tw?: number; sway?: number;
  suck?: { x: number; y: number } | null;
}

interface Ring { x: number; y: number; r: number; maxR: number; alpha: number; color: string; width: number }

const R = (a: number, b: number) => a + Math.random() * (b - a);

export class InkParticles {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private frozenUntil = 0;
  private vortex: { x: number; y: number; until: number } | null = null;
  private emberStormUntil = 0;
  private moteTimer = 0;
  private raf = 0;
  private dead = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.canvas.clientWidth;
    this.H = this.canvas.clientHeight;
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.parts = [];
    this.rings = [];
  }

  private add(p: Particle) {
    if (this.parts.length < 900) this.parts.push(p);
  }

  /* ---- 发射器 ---- */

  /** 墨滴迸溅（可带方向偏置） */
  burstInk(x: number, y: number, n = 26, speed = 5, dirBias: number | null = null) {
    for (let i = 0; i < n; i++) {
      let a = R(0, Math.PI * 2);
      if (dirBias !== null) a = dirBias + R(-0.7, 0.7);
      const sp = R(speed * 0.3, speed);
      this.add({ type: 'ink', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 0.06, drag: 0.955, life: 0, max: R(35, 75), size: R(2.5, 8), rot: R(0, 6), spin: R(-0.1, 0.1) });
    }
  }

  /** 金火星点 */
  burstSparks(x: number, y: number, n = 18, speed = 7) {
    for (let i = 0; i < n; i++) {
      const a = R(0, Math.PI * 2), sp = R(speed * 0.4, speed);
      this.add({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 0.03, drag: 0.96, life: 0, max: R(25, 55), size: R(1, 2.8), tw: R(0, 6) });
    }
  }

  /** 朱红余烬（上飘） */
  burstEmbers(x: number, y: number, n = 14, speed = 4) {
    for (let i = 0; i < n; i++) {
      const a = R(0, Math.PI * 2), sp = R(speed * 0.3, speed);
      this.add({ type: 'ember', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
        g: -0.02, drag: 0.97, life: 0, max: R(40, 90), size: R(1.5, 4), tw: R(0, 6) });
    }
  }

  /** 弹道拖尾（red=追朱砂余烬；sz=粒径倍率，>1 起点粗 → <1 近终点细，形成速度渐变） */
  trail(x: number, y: number, red = false, sz = 1) {
    this.add({ type: 'ink', x: x + R(-6, 6), y: y + R(-6, 6), vx: R(-0.6, 0.6), vy: R(-0.6, 0.6),
      g: 0, drag: 0.94, life: 0, max: R(18, 34), size: R(2, 5.5) * sz, rot: R(0, 6), spin: 0 });
    if (red && Math.random() < 0.5)
      this.add({ type: 'ember', x, y, vx: R(-1, 1), vy: R(-1, 0.4),
        g: -0.01, drag: 0.96, life: 0, max: R(20, 40), size: R(1.5, 3) * sz, tw: R(0, 6) });
  }

  /** 聚气：周围粒子向中心收拢 */
  converge(x: number, y: number, n = 34, r = 150) {
    for (let i = 0; i < n; i++) {
      const a = R(0, Math.PI * 2), rr = R(r * 0.6, r);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      this.add({ type: Math.random() < 0.25 ? 'spark' : 'ink',
        x: px, y: py, vx: (x - px) * 0.055, vy: (y - py) * 0.055,
        g: 0, drag: 0.985, life: 0, max: R(28, 45), size: R(1.5, 4.5), rot: 0, spin: 0 });
    }
  }

  /** 冲击环（椭圆透视贴地） */
  ring(x: number, y: number, maxR = 160, color = '40,36,32', width = 5) {
    this.rings.push({ x, y, r: 12, maxR, alpha: 0.55, color, width });
  }

  /** 涡旋吸入（扭曲虚空） */
  startVortex(x: number, y: number, dur: number) {
    this.vortex = { x, y, until: performance.now() + dur };
  }

  /** 余烬风暴（究极冲击波） */
  emberStorm(dur: number) {
    this.emberStormUntil = performance.now() + dur;
  }

  /** 速度线：放射状墨色线段（奥拉星式爆发帧标配），沿速度方向拉出并缩短消散 */
  burstStreaks(x: number, y: number, n = 10, speed = 9) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R(-0.2, 0.2);
      const sp = R(speed * 0.55, speed);
      this.add({ type: 'streak', x: x + Math.cos(a) * 8, y: y + Math.sin(a) * 8,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 0, drag: 0.9, life: 0, max: R(13, 24), size: R(14, 34) });
    }
  }

  /** 施法墨流：从施法者流向爆点的定向墨点 + 掺朱砂余烬（能量引导线，标注"谁在施法"） */
  stream(x1: number, y1: number, x2: number, y2: number, n = 12) {
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.hypot(dx, dy) || 1;
    const sp = Math.min(9, d / 42);
    for (let i = 0; i < n; i++) {
      const jitter = (i % 3) - 1;
      const ember = i % 3 === 1;
      this.add({
        type: ember ? 'ember' : 'ink',
        x: x1 + jitter * 6, y: y1 + jitter * 4,
        vx: (dx / d) * sp * R(0.7, 1.15), vy: (dy / d) * sp * R(0.7, 1.15),
        g: 0, drag: 0.985, life: 0, max: R(30, 46),
        size: ember ? R(2.2, 3.6) : R(2.5, 5.5),
        rot: R(0, 6), spin: 0, tw: R(0, 6),
      });
    }
  }

  /** 轻墨一缕（施法前摇） */
  puff(x: number, y: number) {
    this.burstInk(x, y, 10, 2.4);
  }

  /** 顿帧：冻结粒子世界（连续顿帧取最晚到期，短冻结不提前解除长冻结） */
  freeze(ms: number) {
    const until = performance.now() + ms;
    if (until > this.frozenUntil) this.frozenUntil = until;
  }

  /* ---- 主循环 ---- */

  private loop(now: number) {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.loop);
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);
    if (now < this.frozenUntil) {
      this.drawAll(now);
      return;
    }

    // 环境墨尘：缓慢上浮的微尘，让画面始终"活"
    if (--this.moteTimer <= 0 && this.parts.length < 850) {
      this.moteTimer = 9;
      this.add({ type: 'mote', x: R(0, W), y: H + 8, vx: R(-0.15, 0.15), vy: R(-0.5, -0.18),
        g: 0, drag: 1, life: 0, max: R(300, 560), size: R(0.8, 2.2), sway: R(0, 6) });
    }
    // 涡旋吸入：切向 + 向心的螺旋粒子
    if (this.vortex && now < this.vortex.until) {
      for (let i = 0; i < 5; i++) {
        const a = R(0, Math.PI * 2), rr = R(150, 320);
        const px = this.vortex.x + Math.cos(a) * rr, py = this.vortex.y + Math.sin(a) * rr * 0.75;
        const dx = this.vortex.x - px, dy = this.vortex.y - py, d = Math.hypot(dx, dy) || 1;
        const tx = -dy / d, ty = dx / d;
        const sp = R(2.4, 4.2);
        this.add({ type: Math.random() < 0.3 ? 'ember' : 'ink', x: px, y: py,
          vx: tx * sp + (dx / d) * 1.5, vy: ty * sp + (dy / d) * 1.5,
          g: 0, drag: 0.995, life: 0, max: R(50, 90), size: R(1.5, 4.5),
          rot: R(0, 6), spin: R(-0.15, 0.15), suck: this.vortex });
      }
    } else {
      this.vortex = null;
    }
    // 余烬风暴：横向贯穿屏幕的火屑
    if (now < this.emberStormUntil) {
      for (let i = 0; i < 4; i++)
        this.add({ type: Math.random() < 0.6 ? 'ember' : 'spark',
          x: R(-40, W * 0.4), y: R(0, H), vx: R(7, 13), vy: R(-1.2, 1.2),
          g: 0, drag: 0.995, life: 0, max: R(60, 120), size: R(1.2, 3.6), tw: R(0, 6) });
    }

    // 更新
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life++;
      if (p.life > p.max) { this.parts.splice(i, 1); continue; }
      if (p.suck) {
        const dx = p.suck.x - p.x, dy = p.suck.y - p.y, d = Math.hypot(dx, dy) || 1;
        p.vx += (dx / d) * 0.35;
        p.vy += (dy / d) * 0.35;
        if (d < 26) { this.parts.splice(i, 1); continue; }
      }
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + (p.g || 0);
      p.x += p.vx;
      p.y += p.vy;
      if (p.rot !== undefined) p.rot += p.spin || 0;
      if (p.sway !== undefined) p.x += Math.sin(p.life / 30 + p.sway) * 0.25;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += (r.maxR - r.r) * 0.14;
      r.alpha *= 0.9;
      if (r.alpha < 0.02) this.rings.splice(i, 1);
    }
    this.drawAll(now);
  }

  private drawAll(now: number) {
    const { ctx } = this;
    // 墨滴 / 微尘 / 速度线（正常混合，深墨色）
    for (const p of this.parts) {
      const t = 1 - p.life / p.max;
      if (p.type === 'ink') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = `rgba(28,25,30,${0.75 * t})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * (0.6 + 0.4 * t), p.size * 0.62 * t + 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.type === 'mote') {
        ctx.fillStyle = `rgba(80,74,66,${0.22 * t})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'streak') {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        ctx.strokeStyle = `rgba(40,36,32,${0.55 * t})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + (p.vx / sp) * p.size * t, p.y + (p.vy / sp) * p.size * t);
        ctx.stroke();
      }
    }
    // 发光粒子：金火 / 朱砂余烬（加色提亮）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.parts) {
      if (p.type !== 'spark' && p.type !== 'ember') continue;
      const t = 1 - p.life / p.max;
      const flick = 0.7 + 0.3 * Math.sin(now / 60 + (p.tw || 0));
      ctx.fillStyle = p.type === 'spark'
        ? `rgba(232,182,76,${0.85 * t * flick})`
        : `rgba(226,80,40,${0.8 * t * flick})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * t), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // 冲击环
    for (const r of this.rings) {
      ctx.strokeStyle = `rgba(${r.color},${r.alpha})`;
      ctx.lineWidth = r.width * (r.alpha + 0.2);
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
