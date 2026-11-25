// One Euro Filter（https://gery.casiez.net/1euro/）を2次元（画面上の点）用にしたもの。
// 止まっているときは強くならして「ぷるぷる」を消し、速く動かしたときはならしを弱めて遅れを出さない
const alphaOf = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };

export function createOneEuro2D({ minCutoff = 1.2, beta = 0.005, dCutoff = 1 } = {}) {
  let x = 0, y = 0, vx = 0, vy = 0, lastT = 0, started = false;
  return {
    filter(px, py, t) {
      if (!started) { started = true; x = px; y = py; vx = vy = 0; lastT = t; return { x, y }; }
      if (!(t > lastT)) return { x, y };
      const dt = Math.min(0.25, t - lastT); lastT = t;
      const ad = alphaOf(dCutoff, dt);
      vx += ad * ((px - x) / dt - vx); vy += ad * ((py - y) / dt - vy);
      const a = alphaOf(minCutoff + beta * Math.hypot(vx, vy), dt);
      x += a * (px - x); y += a * (py - y);
      return { x, y };
    },
    reset() { started = false; },
  };
}
