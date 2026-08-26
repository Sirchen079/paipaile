/**
 * WebAudio 合成音效引擎：零素材依赖，全部现场合成。
 * 质感取向：水墨/太鼓/铜锣/古筝拨弦——短促、低频为主、留白多，不炸耳。
 * 音量刻意压低（这是 Party 游戏不是轰炸秀），静音状态持久化。
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = localStorage.getItem('pp_sfx') === 'off';

  /** 首次用户手势后调用（浏览器自动播放策略）；之后每次播放前兜底 resume */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    } catch { /* 环境不支持音频，静默降级 */ }
  }

  toggle(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('pp_sfx', this.muted ? 'off' : 'on');
    return this.muted;
  }

  private get t0() { return this.ctx!.currentTime; }

  /** 每次发声的随机微变调（±5%）：AOE 连续命中/反复出招不再是机关枪式的同一声响 */
  private jitter() { return 1 + (Math.random() - 0.5) * 0.1; }

  private ok() {
    if (this.muted || !this.ctx) return false;
    this.ensure();
    return !!this.ctx;
  }

  /** 单振荡器：f0→f1 滑频 + 指数衰减包络 */
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const t = this.t0 + delay;
    const j = this.jitter();
    const o = this.ctx!.createOscillator();
    const g = this.ctx!.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0 * j, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * j), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** 噪声爆发：带滤波扫频（打击感的主体） */
  private noise(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1 = f0, delay = 0, q = 1) {
    const t = this.t0 + delay;
    const j = this.jitter();
    const n = Math.floor(this.ctx!.sampleRate * dur);
    const buf = this.ctx!.createBuffer(1, n, this.ctx!.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    const bi = this.ctx!.createBiquadFilter();
    bi.type = filter;
    bi.Q.value = q;
    bi.frequency.setValueAtTime(f0 * j, t);
    if (f1 !== f0) bi.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * j), t + dur);
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bi).connect(g).connect(this.master!);
    src.start(t);
  }

  /** 古筝式拨弦（三角波快衰减，胜利动机用） */
  private pluck(freq: number, vol = 0.2, delay = 0) {
    this.tone('triangle', freq, freq * 0.995, 0.5, vol, delay);
    this.tone('sine', freq * 2, freq * 2, 0.25, vol * 0.35, delay);
  }

  /* ============ UI ============ */

  click() { if (this.ok()) this.noise(0.03, 0.1, 'highpass', 2400); }
  /** 出招确认：轻喝一声 + 轻触觉（移动端） */
  submit() {
    if (!this.ok()) return;
    this.noise(0.14, 0.16, 'bandpass', 500, 1500, 0, 1.5);
    this.tone('sine', 300, 480, 0.1, 0.08);
    try { navigator.vibrate?.(10); } catch { /* 不支持则忽略 */ }
  }
  /** 倒计时最后三秒：木鱼滴答 */
  tick() {
    if (!this.ok()) return;
    this.tone('sine', 940, 900, 0.07, 0.2);
    this.noise(0.02, 0.07, 'highpass', 1400);
  }
  /** 回合开场：太鼓一击 */
  drum() {
    if (!this.ok()) return;
    this.tone('sine', 130, 42, 0.22, 0.5);
    this.noise(0.06, 0.2, 'lowpass', 900, 300);
  }

  /* ============ 出招 ============ */

  /** 爆V：气息上提 */
  chargeUp() {
    if (!this.ok()) return;
    this.tone('sine', 220, 680, 0.28, 0.16);
    this.tone('triangle', 1320, 1760, 0.12, 0.05, 0.18);
  }
  /** 盾起：金属成形 */
  shieldUp(big = false) {
    if (!this.ok()) return;
    this.tone('triangle', big ? 520 : 620, big ? 500 : 600, 0.22, 0.16);
    this.tone('triangle', big ? 780 : 930, big ? 760 : 910, 0.3, 0.1, 0.03);
  }
  flyUp() { if (this.ok()) this.noise(0.24, 0.16, 'bandpass', 350, 2600, 0, 2); }
  burrow() {
    if (!this.ok()) return;
    this.noise(0.28, 0.2, 'lowpass', 420, 90);
    this.tone('sine', 62, 34, 0.3, 0.2);
  }
  /** 冲击波出手：炸雷 */
  zap(big = false) {
    if (!this.ok()) return;
    this.tone('sawtooth', big ? 180 : 140, big ? 50 : 65, big ? 0.16 : 0.12, big ? 0.24 : 0.18);
    this.noise(0.08, 0.14, 'bandpass', 900, 400, 0, 1.2);
  }
  /** 一阳指：清越贯空 */
  beam() {
    if (!this.ok()) return;
    this.tone('triangle', 1240, 320, 0.3, 0.16);
    this.noise(0.2, 0.1, 'highpass', 2000, 3600);
  }
  /** 魔爆术：闷爆 */
  burst() {
    if (!this.ok()) return;
    this.tone('sine', 150, 38, 0.26, 0.4);
    this.noise(0.18, 0.24, 'lowpass', 1400, 200);
  }
  /** 扭曲虚空：深渊下坠 */
  vortex() {
    if (!this.ok()) return;
    this.noise(1.1, 0.14, 'bandpass', 800, 70, 0, 2);
    this.tone('sine', 200, 55, 1.0, 0.12);
  }
  /** 究极蓄势：升腾 */
  ultimateCast() {
    if (!this.ok()) return;
    this.noise(0.6, 0.2, 'bandpass', 220, 3200, 0, 1.5);
    this.tone('sine', 55, 190, 0.55, 0.16);
  }
  /** 究极蓄力升压:低鸣持续上扬(蓄力段循环/单次均可) */
  chargeRise(dur = 0.5) {
    if (!this.ok()) return;
    this.tone('sawtooth', 50, 115, dur, 0.07);
    this.noise(dur, 0.11, 'bandpass', 300, 950, 0, 2);
  }
  /** 究极大字逐字落墨:低频闷錾,随字序升调(一记比一记沉) */
  stamp(i = 0) {
    if (!this.ok()) return;
    this.tone('sine', 96 + i * 14, 40, 0.14, 0.34);
    this.noise(0.05, 0.13, 'lowpass', 700, 240);
  }
  /** 究极释放:重磅轰出(比 ultimateCast 的出手更重) */
  ultimateFire() {
    if (!this.ok()) return;
    this.tone('sine', 170, 30, 0.42, 0.6);
    this.tone('sine', 60, 26, 0.5, 0.4, 0.02);
    this.noise(0.3, 0.4, 'lowpass', 3200, 180);
  }
  ultimateHit() {
    if (!this.ok()) return;
    this.tone('sine', 120, 26, 0.5, 0.55);
    this.tone('sine', 96, 60, 1.1, 0.28, 0.05);
    this.noise(0.4, 0.3, 'lowpass', 2400, 120);
  }

  /* ============ 结算反馈 ============ */

  /** 命中：鼓皮一沉（打击感主体） */
  hit(big = false) {
    if (!this.ok()) return;
    this.tone('sine', big ? 170 : 150, big ? 34 : 42, big ? 0.2 : 0.12, big ? 0.5 : 0.36);
    this.noise(big ? 0.12 : 0.07, big ? 0.3 : 0.2, 'lowpass', 700, 250);
    if (big) this.tone('sine', 55, 27, 0.24, 0.3, 0.02);
  }
  /** 锤系砸落 */
  hammer(big = false) {
    if (!this.ok()) return;
    this.tone('sine', 110, 30, big ? 0.3 : 0.22, big ? 0.55 : 0.45);
    this.noise(0.1, 0.26, 'lowpass', 1000, 300);
  }
  /** 格挡（超盾稳住）：金石之声；重招格挡再垫一记闷沉底鼓（大件撞上来的份量） */
  blocked(big = false) {
    if (!this.ok()) return;
    this.tone('square', 1760, 1720, 0.09, 0.1);
    this.noise(0.03, 0.1, 'highpass', 3000);
    if (big) {
      this.tone('sine', 200, 46, 0.18, 0.38);
      this.tone('square', 2350, 2280, 0.11, 0.06, 0.02);
      this.noise(0.09, 0.14, 'lowpass', 800, 220, 0.01);
    }
  }
  /** 盾碎：脆裂迸溅 */
  shatter() {
    if (!this.ok()) return;
    this.noise(0.13, 0.32, 'lowpass', 1500, 400);
    this.tone('triangle', 1240, 1180, 0.1, 0.12);
    this.tone('triangle', 940, 880, 0.1, 0.1, 0.04);
    this.tone('triangle', 660, 600, 0.12, 0.08, 0.08);
  }
  miss() { if (this.ok()) this.noise(0.11, 0.1, 'bandpass', 650, 380, 0, 1.4); }
  /** 神通被破：嗡鸣作废 */
  cancelBuzz() {
    if (!this.ok()) return;
    this.tone('sawtooth', 230, 85, 0.2, 0.18);
    this.tone('sawtooth', 236, 88, 0.2, 0.12);
  }
  clash() {
    if (!this.ok()) return;
    this.tone('sine', 150, 40, 0.18, 0.45);
    this.tone('triangle', 880, 860, 0.3, 0.1, 0.02);
  }
  /** 阵亡：铜锣送别 */
  death() {
    if (!this.ok()) return;
    this.tone('sine', 98, 92, 1.4, 0.4);
    this.tone('sine', 196, 188, 1.1, 0.16, 0.01);
    this.tone('sine', 289, 280, 0.8, 0.08, 0.02);
    this.noise(0.3, 0.22, 'lowpass', 350, 120);
  }
  /** +1V：得金一声 */
  vGain() { if (this.ok()) { this.pluck(1046, 0.12); this.pluck(1568, 0.08, 0.07); } }

  /* ============ 谢幕 ============ */

  win() {
    if (!this.ok()) return;
    [523, 659, 784, 1046].forEach((f, i) => this.pluck(f, 0.2, i * 0.11));
    this.tone('sine', 98, 96, 1.6, 0.3, 0.5);
    this.tone('sine', 196, 193, 1.2, 0.12, 0.5);
  }
  lose() {
    if (!this.ok()) return;
    this.pluck(392, 0.16);
    this.pluck(294, 0.16, 0.18);
    this.pluck(262, 0.18, 0.38);
  }
}

export const sfx = new Sfx();
