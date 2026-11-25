export function createEffects({ state, clamp, rnd, pick, TAU, W, FX, FB }) {
function burst(x, y, color, n, sp, life) { for (let i = 0; i < n; i++) { const a = rnd(0, TAU), s = rnd(.25, 1) * sp; state.fx.push({ kind: 'p', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 520, life: life * rnd(.6, 1), max: life, size: rnd(3, 7), color }); } }
function ring(x, y, color, rmax) { state.fx.push({ kind: 'r', x, y, life: .45, max: .45, rmax, color }); }
function addText(x, y, text, color, size, life = .9) { state.fx.push({ kind: 't', x: clamp(x, 60, W - 60), y, vy: -70, life, max: life, text, color, size, font: /^[+\-−0-9×A-Z!? ]+$/.test(text) ? FX : FB }); }
function addSlash(x, y, ang, r) { state.fx.push({ kind: 's', x, y, ang, len: r * 2.4, life: .18, max: .18 }); }
function confetti(n) {
  const cols = ['#2ef2ff', '#ff2e88', '#ffd23f', '#a6ff3d', '#8b5cff', '#ffffff'];
  for (let i = 0; i < n; i++) state.fx.push({ kind: 'c', x: rnd(0, W), y: rnd(-260, -10), vx: rnd(-50, 50), vy: rnd(90, 210), rot: rnd(0, TAU), vr: rnd(-8, 8), w: rnd(6, 11), h: rnd(10, 16), color: pick(cols), life: 4.5, max: 4.5 });
}
function updateFx(dt) {
  for (const f of state.fx) {
    f.life -= dt;
    if (f.kind === 'p') { f.vy += f.g * dt; f.x += f.vx * dt; f.y += f.vy * dt; }
    else if (f.kind === 't') f.y += f.vy * dt;
    else if (f.kind === 'c') { f.x += (f.vx + Math.sin(f.rot) * 30) * dt; f.y += f.vy * dt; f.rot += f.vr * dt; }
  }
  state.fx = state.fx.filter(f => f.life > 0); if (state.fx.length > 500) state.fx.splice(0, state.fx.length - 500);
}

// ============================================================
//  流れ（メニュー → 読みこみ → 待機 → READY・3・2・1 → プレイ → FINISH → けっか）
// ============================================================
  return { burst, ring, addText, addSlash, confetti, updateFx };
}
