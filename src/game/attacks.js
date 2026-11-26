export function createAttacks({ TUNING, MON, S, state, rnd, rndi, pick, clamp, lerp, TAU, W, H, Snd, banner, bumpCombo, multOf, burst, ring, addSlash, addText, isBossActive = () => false, onDamage = () => {}, isBarrier = () => false, isQuiet = () => false }) {
// 難易度ごとの値（数字だけ書いてあれば、全部の難易度で同じ）
const byDiff = (v, d) => (v && typeof v === 'object') ? (v[S.diff] ?? d) : (v ?? d);
function updateAttacks(dt) {
  if (!S.attack) return;
  if (isBossActive()) { state.shots = []; return; }
  const A = TUNING.attacks, fly = A.flyTime[S.diff] || 1.8;
  state.shotT -= dt;
  if (state.shotT <= 0) {
    const [a, b] = A.interval[S.diff] || [3.5, 5.5];
    state.shotT = rnd(a, b);
    const maxAt = byDiff(A.maxAtOnce, 2), volley = byDiff(A.volley, 1);
    for (let i = 0; i < volley; i++) {
      if (state.timeLeft > fly + A.windup + .6 && state.shots.filter(s => s.st === 'charge' || s.st === 'fly').length < maxAt) launchShot();
    }
  }
  for (const s of state.shots) updateShot(s, dt, A, fly);
  state.shots = state.shots.filter(s => !s.gone);
}
function launchShot() {
  const busy = new Set(state.shots.filter(s => s.st === 'charge').map(s => s.from));   // 同じ敵が2つ同時に投げないように
  const cand = state.monsters.filter(m => !m.dead && !busy.has(m) && m.age > .3 && !MON[m.type].bad && !MON[m.type].fever && m.x > 90 && m.x < W - 90 && m.y > 70 && m.y < 380);
  const from = cand.length ? pick(cand) : null;   // 画面にいる敵が投げる（いなければ、遠くから飛んでくる）
  const s = { st: 'charge', t: 0, from, x: from ? from.x : rnd(220, W - 220), y: from ? from.y : 150, ox: 0, oy: 0, tx: rnd(170, W - 170), ty: rnd(180, 430), r: 10, vx: 0, vy: 0, gone: false };
  state.shots.push(s); Snd.charge();
  if (!state.attackHinted) { state.attackHinted = true; if (!isQuiet()) banner('ひのたまが くる！', 'warn band', 1700, '大きくなる前に 斬って はじき返せ！'); }
  return s;
}
function updateShot(s, dt, A, fly) {
  s.t += dt;
  if (s.st === 'charge') {
    if (s.from) {
      if (s.from.dead || s.from.x < -40 || s.from.x > W + 40 || s.from.y > H + 40) { s.gone = true; burst(s.x, s.y, '#ff9a3d', 10, 140, .4); return; }   // 投げる前にたおせば、攻撃は消える
      s.x = s.from.x; s.y = s.from.y - s.from.r * .9;
    }
    if (s.t >= A.windup) { s.st = 'fly'; s.t = 0; s.ox = s.x; s.oy = s.y; Snd.launch(); }
  } else if (s.st === 'fly') {
    const k = clamp(s.t / fly, 0, 1);
    s.x = lerp(s.ox, s.tx, k); s.y = lerp(s.oy, s.ty, k); s.r = 10 + 68 * Math.pow(k, 1.7);   // 近づくほど、急に大きく見える
    if (k >= .8 && isBarrier()) { reflectShot(s, null); addText(s.x, s.y - s.r - 50, 'バリア！', '#7df9ff', 22, 1); return; }   // ✌バリア中は、当たる前に自動ではじく
    if (k >= 1) shotHit(s);
  } else if (s.st === 'back') {
    s.x += s.vx * dt; s.y += s.vy * dt; s.r = Math.max(2, s.r * Math.pow(.08, dt));
    if (s.t > .6) { s.gone = true; burst(s.x, s.y, '#ffd23f', 10, 160, .4); }
  }
}
function reflectShot(s, p) {
  s.st = 'back'; s.t = 0; state.reflects++;
  const dx = p ? p.x - p.ox : 0, dy = p ? p.y - p.oy : -1, l = Math.hypot(dx, dy) || 1;
  s.vx = dx / l * 420; s.vy = dy / l * 420 - 380;   // 斬った向きに、奥（上）へはじく
  bumpCombo();
  const pts = TUNING.attacks.reflectPts * multOf(state.combo); state.score += pts;
  burst(s.x, s.y, '#ffd23f', 20, 340, .6); burst(s.x, s.y, '#ffffff', 10, 260, .4); ring(s.x, s.y, '#ffffff', s.r * 2.2); addSlash(s.x, s.y, Math.atan2(dy, dx), s.r);
  addText(s.x, s.y - 6, `+${pts}`, '#ffe66b', 30); addText(s.x, s.y - s.r - 26, 'はじいた！', '#ffffff', 22, 1);
  Snd.clang(); state.shake = Math.max(state.shake, .25);
}
function shotHit(s) {
  s.gone = true; state.shotHits++; state.combo = 0; state.comboT = 0;
  state.timeLeft = Math.max(0, state.timeLeft - TUNING.attacks.penaltySeconds);
  state.shake = 1; state.flashRed = .9; burst(s.x, s.y, '#ff7a1a', 36, 480, .9); burst(s.x, s.y, '#ffd23f', 20, 320, .7);
  state.cracks.push(makeCrack(s.x, s.y)); Snd.impact();
  if (!isQuiet()) banner('OUCH!', 'bomb', 950, `ひのたまに あたった −${TUNING.attacks.penaltySeconds}びょう`);   // 文字を少なくする表示では、赤いフラッシュとヒビだけ
  onDamage();
}
function makeCrack(x, y) {   // 画面のガラスに入るヒビ
  const rays = [], n = rndi(7, 10);
  for (let i = 0; i < n; i++) {
    let a = i / n * TAU + rnd(-.25, .25), px = x, py = y; const pts = [[px, py]], len = rnd(90, 220), seg = rndi(3, 5);
    for (let j = 0; j < seg; j++) { a += rnd(-.45, .45); const d = len / seg; px += Math.cos(a) * d; py += Math.sin(a) * d; pts.push([px, py]); }
    rays.push(pts);
  }
  const rings = [rnd(28, 40), rnd(60, 85)].map(r => ({ r, a0: rnd(0, TAU), span: rnd(1.5, 3.5) }));
  const life = isQuiet() ? TUNING.quietUi.crackLife : 1.8;   // 文字を少なくする表示では、ヒビをすぐ消して前を見やすく
  return { x, y, rays, rings, life, max: life };
}
// ---- エフェクト ----
  return { updateAttacks, launchShot, reflectShot };
}
