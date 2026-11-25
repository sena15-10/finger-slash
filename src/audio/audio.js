export function createAudio({ TUNING, getSound, getTimeLeft, getFever }) {
// ============================================================
const Snd = {
  ctx: null, master: null, bus: null, _nb: null,
  init() {
    try {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(this.ctx.destination);
      this.bus = this.ctx.createGain(); this.bus.gain.value = 0.5; this.bus.connect(this.master);
    } catch (e) { this.ctx = null; }
  },
  ok() { return getSound() && this.ctx && this.ctx.state !== 'closed'; },
  tone(f, d = .12, type = 'triangle', v = .2, to = null, delay = 0) {
    if (!this.ok()) return; const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + .03);
  },
  noiseBuf() { if (!this._nb) { const c = this.ctx, len = Math.floor(c.sampleRate * .6), b = c.createBuffer(1, len, c.sampleRate), a = b.getChannelData(0); for (let i = 0; i < len; i++) a[i] = Math.random() * 2 - 1; this._nb = b; } return this._nb; },
  noise(d = .2, v = .25, f = 1500, delay = 0, type = 'lowpass', out = null) {
    if (!this.ok()) return; const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf(); const fl = c.createBiquadFilter(); fl.type = type;
    fl.frequency.setValueAtTime(f, t); if (type === 'lowpass') fl.frequency.exponentialRampToValueAtTime(Math.max(80, f * .2), t + d);
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    s.connect(fl); fl.connect(g); g.connect(out || this.master); s.start(t); s.stop(t + d + .03);
  },
  // BGM用（時刻を指定して鳴らす）
  note(f, t, d, type, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + d + .02);
  },
  kick(t) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + .12);
    g.gain.setValueAtTime(.6, t); g.gain.exponentialRampToValueAtTime(.0001, t + .16); o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + .18);
  },
  hat(t, v) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf(); const fl = c.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = 7000;
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + .045); s.connect(fl); fl.connect(g); g.connect(this.bus); s.start(t); s.stop(t + .06);
  },
  hit(combo) { const k = Math.min(combo, 14); this.tone(520 + k * 38, .09, 'triangle', .22, 880 + k * 50); this.noise(.07, .12, 3500); },
  hurt() { this.tone(200, .1, 'square', .12, 120); this.noise(.08, .12, 2500); },
  big() { this.tone(240, .22, 'sawtooth', .18, 90); this.noise(.25, .28, 900); this.tone(660, .12, 'triangle', .2, 1200, .05); },
  bomb() { this.noise(.55, .5, 450); this.tone(120, .45, 'sawtooth', .3, 40); },
  star() { [660, 880, 1100, 1320, 1760].forEach((f, i) => this.tone(f, .14, 'square', .1, null, i * .06)); },
  move() { this.tone(980, .035, 'square', .04); },
  select() { this.tone(880, .07, 'square', .1); this.tone(1320, .1, 'square', .1, null, .06); },
  swish() { this.noise(.35, .18, 4000, 0, 'bandpass'); },
  ready() { this.tone(523, .12, 'square', .1); this.tone(784, .2, 'square', .1, null, .12); },
  count() { this.tone(660, .12, 'square', .13); },
  go() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, .3, 'square', .1, null, i * .03)); },
  tick() { this.tone(1400, .03, 'square', .05); },
  alarm() { [0, .18].forEach(d => { this.tone(988, .1, 'square', .1, null, d); this.tone(740, .1, 'square', .1, null, d + .09); }); },
  chime(lv) { const b = 660 + lv * 110; [0, 4, 7, 12].forEach((s, i) => this.tone(b * Math.pow(2, s / 12), .12, 'triangle', .14, null, i * .05)); },
  whistle() { this.tone(1960, .14, 'square', .1, 1900); this.tone(1960, .5, 'square', .1, 1860, .2); },
  stamp() { this.noise(.35, .45, 700); this.tone(110, .35, 'sawtooth', .25, 50); },
  fanfare() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, i === 5 ? .5 : .13, 'square', .11, null, i * .09)); },
  end() { [880, 740, 622, 466].forEach((f, i) => this.tone(f, .2, 'triangle', .2, null, i * .13)); },
  charge() { this.tone(220, .5, 'sawtooth', .06, 660); },
  launch() { this.noise(.35, .22, 1800, 0, 'bandpass'); this.tone(520, .3, 'triangle', .08, 160); },
  clang() { this.tone(1760, .12, 'square', .12, 2400); this.tone(2640, .2, 'triangle', .12); this.noise(.12, .18, 6000, 0, 'highpass'); },
  impact() { this.noise(.6, .55, 600); this.tone(90, .45, 'sawtooth', .3, 40); this.noise(.3, .25, 7000, .05, 'highpass'); },
};
// プレイ中のBGM（4小節をくりかえす。FEVER中は音が増え、ラスト10びょうで速くなる）
const Music = {
  on: false, timer: 0, next: 0, step: 0,
  start() { if (!TUNING.music || !Snd.ctx) return; this.stop(); this.on = true; this.step = 0; this.next = Snd.ctx.currentTime + .06; this.timer = setInterval(() => this.tick(), 25); },
  stop() { this.on = false; clearInterval(this.timer); },
  tick() {
    if (!this.on || !Snd.ok()) return;
    const c = Snd.ctx, bpm = getTimeLeft() <= 10 ? 150 : 132, spb = 60 / bpm / 4;
    if (this.next < c.currentTime - .2) this.next = c.currentTime + .02;
    while (this.next < c.currentTime + .12) { this.play(this.step, this.next); this.next += spb; this.step = (this.step + 1) % 64; }
  },
  play(s, t) {
    const bar = (s / 16) | 0, i = s % 16, root = [57, 53, 48, 55][bar], tones = bar === 0 ? [0, 3, 7, 12] : [0, 4, 7, 12];
    const f = n => 440 * Math.pow(2, (n - 69) / 12), fever = getFever() > 0;
    if (i % 4 === 0) Snd.kick(t);
    if (i % 4 === 2 || (fever && i % 2 === 1)) Snd.hat(t, fever ? .06 : .045);
    if (i % 2 === 0) Snd.note(f(root - 12), t, .12, 'triangle', .2);
    if (i % 2 === 1 || fever) Snd.note(f(root + 12 + tones[[0, 1, 2, 3, 2, 1, 2, 1][i % 8]] + (fever ? 12 : 0)), t, .08, 'square', .035);
  },
};

// ============================================================
//  カメラ

  return { Snd, Music };
}
