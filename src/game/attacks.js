export function createAttacks({ TUNING, MON, S, state, rnd, rndi, pick, clamp, lerp, TAU, W, H, Snd, banner, bumpCombo, multOf, burst, ring, addSlash, addText, isBossActive = () => false, getBossPos = () => null, onBossReflectHit = null,
  addScore = () => {}, resetCombo = () => {}, playerIndexForPtr = () => 0, playerIndexForX = () => 0 }) {
function updateAttacks(dt) {
  const A = TUNING.attacks, fly = A.flyTime[S.diff] || 1.8;
  const bossOn = isBossActive();
  if (S.attack && !bossOn) {
    state.shotT -= dt;
    if (state.shotT <= 0) {
      const [a, b] = A.interval[S.diff] || [3.5, 5.5];
      state.shotT = rnd(a, b);
      if (state.timeLeft > fly + A.windup + .6 && state.shots.filter(s => s.st === 'charge' || s.st === 'fly').length < A.maxAtOnce) launchShot();
    }
  }
  if (bossOn || !S.attack) state.shots = state.shots.filter(s => s.fromBoss);   // ボス戦中・攻撃オフのときは、通常の火の玉だけ消す（ボスの火の玉は残す）
  for (const s of state.shots) updateShot(s, dt, A, fly);
  state.shots = state.shots.filter(s => !s.gone);
}
function launchShot(opts) {
  if (opts && opts.forceFrom) {   // ボス自身が投げる火の玉
    const from = opts.forceFrom, radius = opts.radius || 40;
    const s = { st: 'charge', t: 0, from, fromBoss: true, radius, x: from.x, y: from.y - radius * .9, ox: 0, oy: 0, tx: rnd(170, W - 170), ty: rnd(180, 430), r: 10, vx: 0, vy: 0, gone: false, windup: opts.windup };
    state.shots.push(s); Snd.charge();
    return s;
  }
  const cand = state.monsters.filter(m => !m.dead && m.age > .3 && !MON[m.type].bad && !MON[m.type].fever && m.x > 90 && m.x < W - 90 && m.y > 70 && m.y < 380);
  const from = cand.length ? pick(cand) : null;   // 画面にいる敵が投げる（いなければ、遠くから飛んでくる）
  const s = { st: 'charge', t: 0, from, x: from ? from.x : rnd(220, W - 220), y: from ? from.y : 150, ox: 0, oy: 0, tx: rnd(170, W - 170), ty: rnd(180, 430), r: 10, vx: 0, vy: 0, gone: false };
  state.shots.push(s); Snd.charge();
  if (!state.attackHinted) { state.attackHinted = true; banner('ひのたまが くる！', 'warn band', 1700, '大きくなる前に 斬って はじき返せ！'); }
  return s;
}
function updateShot(s, dt, A, fly) {
  s.t += dt;
  if (s.st === 'charge') {
    if (s.fromBoss) {
      if (!isBossActive()) { s.gone = true; burst(s.x, s.y, '#ff9a3d', 10, 140, .4); return; }   // ボスを倒せば、ためている攻撃も消える
      s.x = s.from.x; s.y = s.from.y - s.radius * .9;
    } else if (s.from) {
      if (s.from.dead || s.from.x < -40 || s.from.x > W + 40 || s.from.y > H + 40) { s.gone = true; burst(s.x, s.y, '#ff9a3d', 10, 140, .4); return; }   // 投げる前にたおせば、攻撃は消える
      s.x = s.from.x; s.y = s.from.y - s.from.r * .9;
    }
    const windup = s.windup != null ? s.windup : A.windup;
    if (s.t >= windup) { s.st = 'fly'; s.t = 0; s.ox = s.x; s.oy = s.y; Snd.launch(); }
  } else if (s.st === 'fly') {
    const k = clamp(s.t / fly, 0, 1);
    s.x = lerp(s.ox, s.tx, k); s.y = lerp(s.oy, s.ty, k); s.r = 10 + 68 * Math.pow(k, 1.7);   // 近づくほど、急に大きく見える
    if (k >= 1) shotHit(s);
  } else if (s.st === 'back') {
    s.x += s.vx * dt; s.y += s.vy * dt; s.r = Math.max(2, s.r * Math.pow(.08, dt));
    if (s.fromBoss && onBossReflectHit && onBossReflectHit(s)) { s.gone = true; return; }
    if (s.t > .6) { s.gone = true; burst(s.x, s.y, '#ffd23f', 10, 160, .4); }
  }
}
function reflectShot(s, p) {
  s.st = 'back'; s.t = 0; state.reflects++;
  const bossPos = s.fromBoss ? getBossPos() : null;
  const dx = bossPos ? bossPos.x - s.x : (p ? p.x - p.ox : 0), dy = bossPos ? bossPos.y - s.y : (p ? p.y - p.oy : -1), l = Math.hypot(dx, dy) || 1;
  s.vx = dx / l * 420; s.vy = dy / l * 420 - (bossPos ? 0 : 380);   // ボスの火の玉は、ボスへ。それ以外は、斬った向きに奥（上）へはじく
  const pi = playerIndexForPtr(p); s.reflectedByPi = pi;   // ボスに当たったとき、この人のダメージにする
  bumpCombo(pi);
  const pts = TUNING.attacks.reflectPts * multOf(pi); addScore(pi, pts);
  burst(s.x, s.y, '#ffd23f', 20, 340, .6); burst(s.x, s.y, '#ffffff', 10, 260, .4); ring(s.x, s.y, '#ffffff', s.r * 2.2); addSlash(s.x, s.y, Math.atan2(dy, dx), s.r);
  addText(s.x, s.y - 6, `+${pts}`, '#ffe66b', 30); addText(s.x, s.y - s.r - 26, 'はじいた！', '#ffffff', 22, 1);
  Snd.clang(); state.shake = Math.max(state.shake, .25);
}
function shotHit(s) {
  s.gone = true; state.shotHits++;
  resetCombo(playerIndexForX(s.x));   // 届いた位置の側（2人プレイなら左右）の人のコンボが切れる
  state.timeLeft = Math.max(0, state.timeLeft - TUNING.attacks.penaltySeconds);
  state.shake = 1; state.flashRed = .9; burst(s.x, s.y, '#ff7a1a', 36, 480, .9); burst(s.x, s.y, '#ffd23f', 20, 320, .7);
  state.cracks.push(makeCrack(s.x, s.y)); Snd.impact();
  banner('OUCH!', 'bomb', 950, `ひのたまに あたった −${TUNING.attacks.penaltySeconds}びょう`);
}
function makeCrack(x, y) {   // 画面のガラスに入るヒビ
  const rays = [], n = rndi(7, 10);
  for (let i = 0; i < n; i++) {
    let a = i / n * TAU + rnd(-.25, .25), px = x, py = y; const pts = [[px, py]], len = rnd(90, 220), seg = rndi(3, 5);
    for (let j = 0; j < seg; j++) { a += rnd(-.45, .45); const d = len / seg; px += Math.cos(a) * d; py += Math.sin(a) * d; pts.push([px, py]); }
    rays.push(pts);
  }
  const rings = [rnd(28, 40), rnd(60, 85)].map(r => ({ r, a0: rnd(0, TAU), span: rnd(1.5, 3.5) }));
  return { x, y, rays, rings, life: 1.8, max: 1.8 };
}
// ---- エフェクト ----
  return { updateAttacks, launchShot, reflectShot };
}
