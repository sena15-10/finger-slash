import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from './src/config.js';
import { bossHpPercent, createBoss, damageBoss, damageBossFlat, reflectDamageBoss, shouldSpawnBoss, updateBoss, updateBossShots } from './src/game/boss.js';
import { createAttacks } from './src/game/attacks.js';
import { createGhostSample, ghostResultText, hasAnyHand, normalizeGhostPoint, packGhost, sampleGhost, unpackGhost } from './src/game/ghost.js';
import {
  addGauge, classifyHandShape, consumeFist, countBentFingers, createGestureState, createHoldTracker,
  shotInsideShield, tryActivateShield, updateHold, updateShieldTimers,
} from './src/game/gesture.js';
import {
  creditBossResult, handSize, makeTwoEntry, playerIndexForX, pruneTwoScores, removeTodayTwoScores,
  selectTwoPlayerHands, twoBoardRows, twoPlayerVerdict,
} from './src/game/two.js';
import { comboMultiplier } from './src/game/scoring.js';
import { MON } from './src/game/monsters.js';

// にせAIの手: 曲がっている指の本数(0〜4)・大きさ・位置を指定して、21点のランドマーク（画面ピクセル座標）を作る
function makeHandLandmarks({ bentCount = 0, size = 150, cx = 480, cy = 270 } = {}) {
  const points = new Array(21).fill(null).map(() => ({ x: cx, y: cy }));
  points[0] = { x: cx, y: cy + size };   // 手首
  points[9] = { x: cx, y: cy + size * 0.4 };   // 手のひら中心
  [[8, 6], [12, 10], [16, 14], [20, 18]].forEach(([tip, pip], i) => {
    const bent = i < bentCount, fx = cx + (i - 1.5) * size * 0.12;
    points[pip] = { x: fx, y: cy + size - size * 0.5 };
    points[tip] = { x: fx, y: cy + size - (bent ? size * 0.2 : size * 0.9) };
  });
  return points;
}
// にせAIの「見つけた手」1つ分（runtime の AI.hands と同じ形: pts・raw・size）
function makeHand(opts = {}) {
  const pts = makeHandLandmarks(opts);
  return { pts, raw: pts, size: handSize(pts) };
}

const noop = () => {};
const SndStub = { charge: noop, launch: noop, clang: noop, hurt: noop, big: noop, impact: noop };
const stubFx = {
  banner: noop, bumpCombo: noop, multOf: () => 1, burst: noop, ring: noop, addSlash: noop, addText: noop, Snd: SndStub,
  rnd: (a, b) => (a + b) / 2, rndi: (a, b) => Math.floor((a + b) / 2), pick: a => a[0], clamp: (v, a, b) => v < a ? a : v > b ? b : v,
  lerp: (a, b, t) => a + (b - a) * t, TAU: Math.PI * 2, W: 960, H: 540,
};

test('boss appears once when the remaining round time reaches its threshold (per round length)', () => {
  for (const time of [30, 60]) {
    const appearAt = TUNING.boss.appearAt[time];
    assert.equal(shouldSpawnBoss(true, false, appearAt + 0.01, appearAt), false);
    assert.equal(shouldSpawnBoss(true, false, appearAt, appearAt), true);
    assert.equal(shouldSpawnBoss(true, true, 0, appearAt), false);
    assert.equal(shouldSpawnBoss(false, false, 0, appearAt), false);
  }
  assert.equal(TUNING.boss.appearAt[30], 5);
  assert.equal(TUNING.boss.appearAt[60], 15);
});

test('boss hp is set per round length', () => {
  assert.equal(TUNING.boss.hp[30], 150);
  assert.equal(TUNING.boss.hp[60], 300);
  const boss30 = createBoss(TUNING.boss, TUNING.boss.hp[30], 960, 540, 0);
  const boss60 = createBoss(TUNING.boss, TUNING.boss.hp[60], 960, 540, 0);
  assert.equal(boss30.hp, 150);
  assert.equal(boss60.hp, 300);
});

test('slashes below minSlashSpeed do nothing; speed right at minSlashSpeed damages the boss', () => {
  const boss = createBoss(TUNING.boss, TUNING.boss.hp[30], 960, 540, 0);
  assert.equal(damageBoss(boss, 219, TUNING.boss).applied, false);
  assert.equal(boss.hp, 150);
  const result = damageBoss(boss, 221, TUNING.boss);
  assert.equal(result.applied, true);
  assert.equal(boss.hp, 150 - TUNING.boss.slashDamage);
});

test('slash cooldown blocks a second hit from the same player before 0.12s, allows it at exactly 0.12s', () => {
  const boss = createBoss(TUNING.boss, TUNING.boss.hp[30], 960, 540, 0);
  assert.equal(damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p1').applied, true);
  updateBoss(boss, 0.11, TUNING.boss, 960);
  assert.equal(damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p1').applied, false);
  updateBoss(boss, 0.01, TUNING.boss, 960);   // ちょうど0.12びょう経過
  assert.equal(damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p1').applied, true);
  assert.equal(boss.hp, 150 - TUNING.boss.slashDamage * 2);
});

test('slash cooldown is tracked per player', () => {
  const boss = createBoss(TUNING.boss, TUNING.boss.hp[30], 960, 540, 0);
  assert.equal(damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p1').applied, true);
  assert.equal(damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p2').applied, true);
  assert.equal(boss.hp, 150 - TUNING.boss.slashDamage * 2);
});

test('boss paces left-right within moveMargin of the arena edges', () => {
  const boss = createBoss(TUNING.boss, TUNING.boss.hp[30], 960, 540, 0);
  boss.x = 960 - TUNING.boss.moveMargin;
  boss.vx = Math.abs(TUNING.boss.moveSpeed);
  updateBoss(boss, 0.01, TUNING.boss, 960);
  assert.equal(boss.x, 960 - TUNING.boss.moveMargin);
  assert.ok(boss.vx < 0);
  boss.x = TUNING.boss.moveMargin;
  boss.vx = -Math.abs(TUNING.boss.moveSpeed);
  updateBoss(boss, 0.01, TUNING.boss, 960);
  assert.equal(boss.x, TUNING.boss.moveMargin);
  assert.ok(boss.vx > 0);

  const patrol = createBoss(TUNING.boss, TUNING.boss.hp[30], 960, 540, 0);
  let bounced = false;
  for (let frame = 0; frame < 600; frame++) {
    const oldX = patrol.x;
    updateBoss(patrol, 1 / 60, TUNING.boss, 960);
    if (patrol.x !== oldX && (patrol.x === TUNING.boss.moveMargin || patrol.x === 960 - TUNING.boss.moveMargin)) bounced = true;
    assert.equal(patrol.y, 540 * TUNING.boss.yRatio);   // 上下には動かない
  }
  assert.equal(bounced, true);
});

test('boss fires on schedule (appear+3, +6, ...), telegraphs 0.6s before, and caps concurrent shots', () => {
  const boss = createBoss(TUNING.boss, TUNING.boss.hp[30], 960, 540, 10);   // 出現時刻 = 10
  assert.equal(updateBossShots(boss, 10 + 2.39, TUNING.boss, 0), null);
  assert.equal(updateBossShots(boss, 10 + 2.4, TUNING.boss, 0), 'launch');   // 発射(+3)の0.6びょう前
  assert.equal(boss.telegraphUntil, 10 + 3);
  for (let t = 10 + 2.41; t < 10 + 3; t += 0.1) assert.equal(updateBossShots(boss, t, TUNING.boss, 1), null);
  assert.equal(updateBossShots(boss, 10 + 5.39, TUNING.boss, 0), null);
  assert.equal(updateBossShots(boss, 10 + 5.4, TUNING.boss, TUNING.boss.maxShots), null);   // 上限なのでスキップ
  assert.equal(boss.telegraphUntil, 0);
  assert.equal(updateBossShots(boss, 10 + 8.4, TUNING.boss, 0), 'launch');   // 次の周期は+9
});

test('reflecting a fireball into the boss deals reflectDamage and clears the shot, without the speed/cooldown gate', () => {
  const boss = createBoss(TUNING.boss, TUNING.boss.hp[30], 960, 540, 0);
  const result = reflectDamageBoss(boss, TUNING.boss);
  assert.equal(result.applied, true);
  assert.equal(boss.hp, 150 - TUNING.boss.reflectDamage);
  // 速さ・クールダウンに関係なく、連続でも入る
  assert.equal(reflectDamageBoss(boss, TUNING.boss).applied, true);
  assert.equal(boss.hp, 150 - TUNING.boss.reflectDamage * 2);
});

test('boss defeat pays exactly defeatBonus regardless of combo, only once', () => {
  const boss = createBoss(TUNING.boss, TUNING.boss.hp[30], 960, 540, 0);
  let bonus = 0, hits = 0;
  while (boss.hp > 0) {
    const result = damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p1');
    assert.equal(result.applied, true);
    bonus += result.bonus;
    hits++;
    updateBoss(boss, TUNING.boss.slashCooldown, TUNING.boss, 960);
  }
  assert.equal(boss.hp, 0);
  assert.equal(bonus, TUNING.boss.defeatBonus);
  assert.equal(hits, 150 / TUNING.boss.slashDamage);
  assert.equal(damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p1').applied, false);
});

test('bossHpPercent rounds up so 1 remaining HP never shows 0%, and is omitted when there is no boss', () => {
  const boss = createBoss(TUNING.boss, 150, 960, 540, 0);
  boss.hp = 1;
  assert.equal(bossHpPercent(boss), 1);
  boss.hp = 0;
  assert.equal(bossHpPercent(boss), 0);
  assert.equal(bossHpPercent(null), 0);
});

test('damageBossFlat applies a flat amount regardless of speed/cooldown (used by the gesture punch)', () => {
  const boss = createBoss(TUNING.boss, 150, 960, 540, 0);
  const result = damageBossFlat(boss, 30, TUNING.boss);
  assert.equal(result.applied, true);
  assert.equal(boss.hp, 120);
});

test('normal fireball attacks are suppressed while the boss is alive, but the boss keeps throwing its own', () => {
  const attackState = { shots: [{ st: 'fly' }], shotT: 0, timeLeft: 5 };
  const attacks = createAttacks({
    TUNING, MON: {}, S: { attack: true, diff: 'normal' }, state: attackState,
    isBossActive: () => true,
  });
  attacks.updateAttacks(0.1);
  assert.deepEqual(attackState.shots, []);
  assert.equal(attackState.shotT, 0);

  const bossShotState = { shots: [], shotT: 0, timeLeft: 5 };
  const boss = { x: 480, y: 150 };
  const bossAttacks = createAttacks({
    TUNING, MON: {}, S: { attack: true, diff: 'normal' }, state: bossShotState, ...stubFx,
    isBossActive: () => true, getBossPos: () => ({ x: boss.x, y: boss.y }),
  });
  bossAttacks.launchShot({ forceFrom: boss, windup: TUNING.boss.telegraph, radius: TUNING.boss.radius });
  assert.equal(bossShotState.shots.length, 1);
  bossAttacks.updateAttacks(TUNING.boss.telegraph + 0.01);   // たまり終わって飛び出す
  assert.equal(bossShotState.shots.length, 1);
  assert.equal(bossShotState.shots[0].st, 'fly');
});

test('reflected boss fireballs home toward the boss position', () => {
  const state = { shots: [], shotT: 0, timeLeft: 5, reflects: 0, combo: 0, comboT: 0, score: 0, shake: 0 };
  const boss = { x: 700, y: 120 };
  const attacks = createAttacks({
    TUNING, MON: {}, S: { attack: true, diff: 'normal' }, state, ...stubFx,
    isBossActive: () => true, getBossPos: () => ({ x: boss.x, y: boss.y }),
  });
  const s = attacks.launchShot({ forceFrom: boss, windup: 0, radius: TUNING.boss.radius });
  s.x = 300; s.y = 300;
  attacks.reflectShot(s, null);
  assert.ok(s.vx > 0);   // boss.x(700) > s.x(300) なので、右へ向かう
  assert.ok(s.vy < 0);   // boss.y(120) < s.y(300) なので、上へ向かう
});

test('ghost samples interpolate both hand positions and the previous score at the same time', () => {
  const samples = [
    { t: 0, p: [{ x: 10, y: 20 }, { x: 30, y: 40 }], s: 100 },
    { t: 0.2, p: [{ x: 30, y: 40 }, { x: 50, y: 60 }], s: 300 },
  ];
  assert.deepEqual(sampleGhost(samples, 0.1), {
    t: 0.1,
    p: [{ x: 20, y: 30 }, { x: 40, y: 50 }],
    s: 200,
  });
});

test('ghost storage round-trips a 60s round (variable hand count, normalized coords), with no extra personal data', () => {
  const sampleCount = Math.round(60 / TUNING.ghost.interval);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const t = index * TUNING.ghost.interval;
    const hands = index % 7 === 0 ? [] : index % 3 === 0 ? [normalizeGhostPoint(index % 960, 270, 960, 540)] : [normalizeGhostPoint(index % 960, 270, 960, 540), normalizeGhostPoint(700, 400, 960, 540)];
    return createGhostSample(t, hands, index * 10);
  });
  const packed = packGhost(samples);
  const serialized = JSON.stringify(packed);
  const restored = unpackGhost(JSON.parse(serialized));
  assert.equal(restored[0].t, 0);
  assert.equal(restored[restored.length - 1].t, samples[samples.length - 1].t);
  assert.equal(restored[restored.length - 1].s, samples[samples.length - 1].s);
  assert.equal(restored.some(s => s.p.length === 0), true);
  assert.equal(restored.some(s => s.p.length === 1), true);
  assert.equal(restored.some(s => s.p.length === 2), true);
  assert.ok(restored.every(s => s.p.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)));
  assert.equal(serialized.includes('name'), false);
  assert.equal(serialized.includes('face'), false);
  assert.equal(serialized.includes('video'), false);
});

test('normalizeGhostPoint clamps to 0..1 and keeps 3 decimal places', () => {
  assert.deepEqual(normalizeGhostPoint(480, 270, 960, 540), { x: 0.5, y: 0.5 });
  assert.deepEqual(normalizeGhostPoint(-50, 1000, 960, 540), { x: 0, y: 1 });
  assert.deepEqual(normalizeGhostPoint(960 + 50, 540 + 50, 960, 540), { x: 1, y: 1 });
});

test('hasAnyHand is false only when every recorded sample has an empty hand list', () => {
  assert.equal(hasAnyHand([createGhostSample(0, [], 0), createGhostSample(0.1, [], 10)]), false);
  assert.equal(hasAnyHand([createGhostSample(0, [], 0), createGhostSample(0.1, [{ x: 0.5, y: 0.5 }], 10)]), true);
});

test('a ghost sample recorded right at the round end is used as the final comparison score', () => {
  const samples = [
    createGhostSample(0, [{ x: 0.1, y: 0.1 }], 0),
    createGhostSample(30, [{ x: 0.9, y: 0.9 }], 420),
  ];
  const packed = packGhost(samples);
  const restored = unpackGhost(packed);
  assert.equal(ghostResultText(419, restored), 'あと1点で前の人こえ');
  assert.equal(ghostResultText(420, restored), '前の人と同点！');
  assert.equal(ghostResultText(421, restored), '前の人をこえた！');
});

test('ghost result explains whether the previous player was passed', () => {
  const previous = [{ t: 0, p: [{ x: 0, y: 0 }, { x: 0, y: 0 }], s: 500 }];
  assert.equal(ghostResultText(600, previous), '前の人をこえた！');
  assert.equal(ghostResultText(450, previous), 'あと50点で前の人こえ');
  assert.equal(ghostResultText(500, previous), '前の人と同点！');
});

test('countBentFingers counts 0 to 4 bent fingers from synthetic landmarks', () => {
  for (let bentCount = 0; bentCount <= 4; bentCount++) {
    assert.equal(countBentFingers(makeHandLandmarks({ bentCount })), bentCount);
  }
});

test('classifyHandShape: 2 bent fingers is neither, 3 is a fist, 0 is an open hand', () => {
  assert.equal(classifyHandShape(makeHandLandmarks({ bentCount: 2 }), TUNING.gesture), 'none');
  assert.equal(classifyHandShape(makeHandLandmarks({ bentCount: 3 }), TUNING.gesture), 'fist');
  assert.equal(classifyHandShape(makeHandLandmarks({ bentCount: 4 }), TUNING.gesture), 'fist');
  assert.equal(classifyHandShape(makeHandLandmarks({ bentCount: 0 }), TUNING.gesture), 'open');
  assert.equal(classifyHandShape(makeHandLandmarks({ bentCount: 1 }), TUNING.gesture), 'none');
});

test('hand size and position do not affect the shape classification', () => {
  assert.equal(classifyHandShape(makeHandLandmarks({ bentCount: 3, size: 40, cx: 100, cy: 500 }), TUNING.gesture), 'fist');
  assert.equal(classifyHandShape(makeHandLandmarks({ bentCount: 0, size: 300, cx: 800, cy: 50 }), TUNING.gesture), 'open');
});

test('a fist hold of 0.49s does not trigger; 0.50s does', () => {
  const tracker = createHoldTracker();
  for (let i = 0; i < 49; i++) updateHold(tracker, true, 0.01, TUNING.gesture.graceMs);
  assert.ok(tracker.held < TUNING.gesture.fistHold);
  updateHold(tracker, true, 0.01, TUNING.gesture.graceMs);
  assert.ok(tracker.held >= TUNING.gesture.fistHold);
});

test('a gap of up to graceMs while the shape breaks does not reset the hold timer', () => {
  const tracker = createHoldTracker();
  updateHold(tracker, true, 0.3, TUNING.gesture.graceMs);
  updateHold(tracker, false, TUNING.gesture.graceMs / 1000 - 0.001, TUNING.gesture.graceMs);   // 120ms未満の途切れ
  assert.equal(tracker.held, 0.3);   // リセットされない
  updateHold(tracker, true, 0.2, TUNING.gesture.graceMs);
  assert.ok(Math.abs(tracker.held - 0.5) < 1e-9);
});

test('a gap longer than graceMs resets the hold timer', () => {
  const tracker = createHoldTracker();
  updateHold(tracker, true, 0.3, TUNING.gesture.graceMs);
  updateHold(tracker, false, TUNING.gesture.graceMs / 1000 + 0.001, TUNING.gesture.graceMs);
  assert.equal(tracker.held, 0);
});

test('gauge: +10% per enemy, +2% per boss hit, capped at 100%', () => {
  const g = createGestureState();
  for (let i = 0; i < 9; i++) addGauge(g, TUNING.gesture.gaugeEnemy);
  assert.equal(g.gauge, 90);
  addGauge(g, TUNING.gesture.gaugeBossHit);
  assert.equal(g.gauge, 92);
  addGauge(g, TUNING.gesture.gaugeEnemy);
  assert.equal(g.gauge, 100);   // 100%で止まる
});

test('consumeFist needs both gauge 100% and the fistHold duration; resets both on success', () => {
  const g = createGestureState();
  g.gauge = 99; g.fist.held = TUNING.gesture.fistHold;
  assert.equal(consumeFist(g, TUNING.gesture), false);   // ゲージが99%
  g.gauge = 100; g.fist.held = TUNING.gesture.fistHold - 0.01;
  assert.equal(consumeFist(g, TUNING.gesture), false);   // 保持が足りない
  g.fist.held = TUNING.gesture.fistHold;
  assert.equal(consumeFist(g, TUNING.gesture), true);
  assert.equal(g.gauge, 0);
  assert.equal(g.fist.held, 0);
});

test('shield activates at openHold (0.29s does not, 0.30s does)', () => {
  const g = createGestureState();
  g.open.held = TUNING.gesture.openHold - 0.01;
  assert.equal(tryActivateShield(g, TUNING.gesture), false);
  g.open.held = TUNING.gesture.openHold;
  assert.equal(tryActivateShield(g, TUNING.gesture), true);
  assert.equal(g.shieldActive, true);
  assert.equal(g.shieldTimeLeft, TUNING.gesture.shieldDuration);
  assert.equal(g.shieldCooldownLeft, TUNING.gesture.shieldCooldown);
  assert.equal(g.open.held, 0);
});

test('the shield lasts shieldDuration seconds, then turns off', () => {
  const g = createGestureState();
  g.open.held = TUNING.gesture.openHold;
  tryActivateShield(g, TUNING.gesture);
  updateShieldTimers(g, TUNING.gesture.shieldDuration - 0.01);
  assert.equal(g.shieldActive, true);
  updateShieldTimers(g, 0.02);
  assert.equal(g.shieldActive, false);
});

test('the shield cannot be reactivated before an 8s cooldown elapses, counted from the moment of activation', () => {
  const g = createGestureState();
  g.open.held = TUNING.gesture.openHold;
  tryActivateShield(g, TUNING.gesture);   // クールダウンは、この瞬間から数え始める
  updateShieldTimers(g, TUNING.gesture.shieldCooldown - 0.01);
  g.open.held = TUNING.gesture.openHold;
  assert.equal(tryActivateShield(g, TUNING.gesture), false);   // まだ0.01びょう残っている
  updateShieldTimers(g, 0.02);
  g.open.held = TUNING.gesture.openHold;
  assert.equal(tryActivateShield(g, TUNING.gesture), true);   // 8びょう経過で再使用できる
});

test('fireballs inside an active shield are consumed; an inactive shield consumes nothing', () => {
  const g = createGestureState();
  g.shieldActive = true; g.shieldX = 500; g.shieldY = 300;
  assert.equal(shotInsideShield(500 + TUNING.gesture.shieldRadius - 1, 300, g, TUNING.gesture.shieldRadius), true);
  assert.equal(shotInsideShield(500 + TUNING.gesture.shieldRadius + 1, 300, g, TUNING.gesture.shieldRadius), false);
  g.shieldActive = false;
  assert.equal(shotInsideShield(500, 300, g, TUNING.gesture.shieldRadius), false);
});

// ============================================================
//  フェーズ3: 2人同時プレイ
// ============================================================
const TW = 960;
const twoOpts = { width: TW, minPx: TUNING.boothMinHandPx, centerDeadZone: TUNING.two.centerDeadZone };

test('TUNING.two keeps the specified values', () => {
  assert.deepEqual(TUNING.two, { duration: 60, maxHands: 4, centerDeadZone: 0.04 });
});

test('two players: one hand on each side goes to left (0) and right (1)', () => {
  const left = makeHand({ cx: 200 }), right = makeHand({ cx: 760 });
  const [l, r] = selectTwoPlayerHands([right, left], twoOpts);   // AIが返す順番に関係なく
  assert.equal(l, left);
  assert.equal(r, right);
});

test('two players: with a big and a small hand on one side, only the bigger one is used', () => {
  const big = makeHand({ cx: 250, size: 200 }), small = makeHand({ cx: 150, size: 120 }), right = makeHand({ cx: 700 });
  const [l, r] = selectTwoPlayerHands([small, right, big], twoOpts);
  assert.equal(l, big);
  assert.equal(r, right);
  const [l2, r2] = selectTwoPlayerHands([small, big], twoOpts);   // 右にだれもいなければ、右は空
  assert.equal(l2, big);
  assert.equal(r2, null);
});

test('two players: a hand inside the center dead zone belongs to nobody; just outside it is used', () => {
  const half = TW * TUNING.two.centerDeadZone / 2;   // 19.2px
  assert.deepEqual(selectTwoPlayerHands([makeHand({ cx: TW / 2 })], twoOpts), [null, null]);
  assert.deepEqual(selectTwoPlayerHands([makeHand({ cx: TW / 2 + Math.floor(half) })], twoOpts), [null, null]);
  assert.deepEqual(selectTwoPlayerHands([makeHand({ cx: TW / 2 - Math.floor(half) })], twoOpts), [null, null]);
  const justRight = makeHand({ cx: TW / 2 + Math.ceil(half) }), justLeft = makeHand({ cx: TW / 2 - Math.ceil(half) });
  assert.deepEqual(selectTwoPlayerHands([justRight, justLeft], twoOpts), [justLeft, justRight]);
});

test('two players: a small hand from someone standing behind is ignored, even when it is the only one on that side', () => {
  const back = makeHand({ cx: 800, size: 20 });   // 写った大きさ 12px < boothMinHandPx
  assert.ok(back.size < TUNING.boothMinHandPx);
  const front = makeHand({ cx: 200 });
  assert.deepEqual(selectTwoPlayerHands([back, front], twoOpts), [front, null]);
  // ブース表示でなければ（minPx=0）、小さい手も使う
  assert.deepEqual(selectTwoPlayerHands([back, front], { ...twoOpts, minPx: 0 }), [front, back]);
});

test('two players: four hands (two people, both hands up) -> one per side, the biggest each', () => {
  const hands = [makeHand({ cx: 120, size: 140 }), makeHand({ cx: 330, size: 170 }), makeHand({ cx: 620, size: 160 }), makeHand({ cx: 860, size: 150 })];
  const [l, r] = selectTwoPlayerHands(hands, twoOpts);
  assert.equal(l, hands[1]);
  assert.equal(r, hands[2]);
});

test('playerIndexForX: always 0 for one player; left half 0 / right half 1 for two players', () => {
  for (const x of [0, 479, 480, 959]) assert.equal(playerIndexForX(x, TW, false), 0);
  assert.equal(playerIndexForX(0, TW, true), 0);
  assert.equal(playerIndexForX(479.9, TW, true), 0);
  assert.equal(playerIndexForX(480, TW, true), 1);
  assert.equal(playerIndexForX(959, TW, true), 1);
});

// 2人プレイの攻撃まわり: runtime と同じつなぎ方で createAttacks を作る
function makeTwoAttacks({ two = true, boss = null } = {}) {
  const ptrs = [{ x: 0, y: 0, ox: 0, oy: 0 }, { x: 0, y: 0, ox: 0, oy: 0 }];
  const log = { scores: [0, 0], resets: [], bumps: [] };
  const state = { shots: [], shotT: 99, timeLeft: 60, monsters: [], reflects: 0, shotHits: 0, shake: 0, flashRed: 0, attackHinted: true, cracks: [], feverT: 0 };
  const attacks = createAttacks({
    TUNING, MON: {}, S: { attack: true, diff: 'normal', two }, state, ...stubFx,
    bumpCombo: pi => log.bumps.push(pi), multOf: () => 1,
    isBossActive: () => !!boss && boss.hp > 0, getBossPos: () => boss ? { x: boss.x, y: boss.y } : null,
    addScore: (pi, v) => { log.scores[pi] += v; }, resetCombo: pi => log.resets.push(pi),
    playerIndexForPtr: p => two && p === ptrs[1] ? 1 : 0,
    playerIndexForX: x => playerIndexForX(x, TW, two),
  });
  return { attacks, state, ptrs, log };
}

test('reflecting a fireball scores for (and bumps the combo of) the player who slashed it, and remembers who did', () => {
  const { attacks, ptrs, log } = makeTwoAttacks();
  const s = attacks.launchShot();
  attacks.reflectShot(s, ptrs[1]);
  assert.equal(s.reflectedByPi, 1);
  assert.deepEqual(log.bumps, [1]);
  assert.deepEqual(log.scores, [0, TUNING.attacks.reflectPts]);
  const s2 = attacks.launchShot();
  attacks.reflectShot(s2, ptrs[0]);
  assert.equal(s2.reflectedByPi, 0);
  assert.deepEqual(log.scores, [TUNING.attacks.reflectPts, TUNING.attacks.reflectPts]);
});

test('a fireball that lands breaks the combo of the player on that side only', () => {
  const fly = TUNING.attacks.flyTime.normal;
  for (const [tx, two, expected] of [[700, true, 1], [200, true, 0], [700, false, 0]]) {
    const { attacks, state, log } = makeTwoAttacks({ two });
    const s = attacks.launchShot(); s.tx = tx;
    attacks.updateAttacks(TUNING.attacks.windup + 0.01);   // たまり終わって飛び出す
    attacks.updateAttacks(fly + 0.01);                     // 届く
    assert.equal(state.shotHits, 1);
    assert.deepEqual(log.resets, [expected], `tx=${tx} two=${two}`);
  }
});

test('boss defeat bonus goes to whoever dealt the final damage (slash, reflect, or fist)', () => {
  // 左の人が削って、右の人がとどめ
  const boss = createBoss(TUNING.boss, TUNING.boss.slashDamage * 2, 960, 540, 0);
  const scores = [0, 0], add = (pi, v) => { scores[pi] += v; };
  creditBossResult(damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p1'), 0, add);
  assert.deepEqual(scores, [0, 0]);
  creditBossResult(damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p2'), 1, add);   // 人ごとのクールダウンなので、すぐ入る
  assert.equal(boss.hp, 0);
  assert.deepEqual(scores, [0, TUNING.boss.defeatBonus]);

  // はね返し: s.reflectedByPi の人に入る
  const boss2 = createBoss(TUNING.boss, TUNING.boss.reflectDamage, 960, 540, 0);
  const { attacks, ptrs } = makeTwoAttacks({ boss: boss2 });
  const s = attacks.launchShot({ forceFrom: boss2, windup: 0, radius: TUNING.boss.radius });
  attacks.reflectShot(s, ptrs[0]);
  const scores2 = [0, 0];
  creditBossResult(reflectDamageBoss(boss2, TUNING.boss), s.reflectedByPi ?? 0, (pi, v) => { scores2[pi] += v; });
  assert.deepEqual(scores2, [TUNING.boss.defeatBonus, 0]);

  // グーの全体攻撃でとどめ
  const boss3 = createBoss(TUNING.boss, TUNING.gesture.fistBossDamage, 960, 540, 0);
  const scores3 = [0, 0];
  creditBossResult(damageBossFlat(boss3, TUNING.gesture.fistBossDamage, TUNING.boss), 1, (pi, v) => { scores3[pi] += v; });
  assert.deepEqual(scores3, [0, TUNING.boss.defeatBonus]);
  // 撃破していないダメージは何も入れない
  assert.equal(creditBossResult({ applied: true, defeated: false, bonus: 0 }, 0, () => assert.fail()), 0);
});

test('two-player result: higher score wins, equal is a draw', () => {
  assert.equal(twoPlayerVerdict(500, 300), 'l');
  assert.equal(twoPlayerVerdict(300, 500), 'r');
  assert.equal(twoPlayerVerdict(400, 400), 'draw');
  assert.equal(twoPlayerVerdict(0, 0), 'draw');
});

test('two-player ranking stores {total,l,r,ts}, shows "左◯／右◯", keeps today + best 50 of other days, reset removes only today', () => {
  const dayKey = ts => String(Math.floor(ts / 1000));   // テスト用: 1000ms = 1日
  const e = makeTwoEntry(300, 450, 5500);
  assert.deepEqual(e, { total: 750, l: 300, r: 450, ts: 5500 });
  assert.deepEqual(Object.keys(e).sort(), ['l', 'r', 'total', 'ts']);
  assert.deepEqual(twoBoardRows([e]), [{ n: '左300／右450', s: 750, at: 5500 }]);

  const old = Array.from({ length: 60 }, (_, i) => makeTwoEntry(i, 0, 1000 + i));   // 前の日の60件
  const today = Array.from({ length: 70 }, (_, i) => makeTwoEntry(0, i, 5000 + i));
  const kept = pruneTwoScores([...old, ...today, { s: 10 }, null], '5', dayKey);   // こわれた記録・1人用の形は捨てる
  assert.equal(kept.filter(x => dayKey(x.ts) === '5').length, 70);
  const keptOld = kept.filter(x => dayKey(x.ts) === '1');
  assert.equal(keptOld.length, 50);
  assert.equal(Math.min(...keptOld.map(x => x.total)), 10);   // ベスト50（59〜10）

  const afterReset = removeTodayTwoScores(kept, '5', dayKey);
  assert.equal(afterReset.length, 50);
  assert.ok(afterReset.every(x => dayKey(x.ts) === '1'));
  assert.deepEqual(removeTodayTwoScores(null, '5', dayKey), []);
});

// ============================================================
//  perf: 実ブラウザ・実AIなし。純粋ロジックだけを1コマずつ動かして時間を測る
//  （描画・カメラ・MediaPipe の推論時間は含まない）
// ============================================================
function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function simulateFrames({ two, frames }) {
  const W = 960, H = 540, dt = 1 / 60, times = [];
  const types = Object.keys(MON);
  const ptrs = [{ x: 200, y: 300, ox: 200, oy: 300, active: true }, { x: 700, y: 300, ox: 700, oy: 300, active: true }];
  const scores = [0, 0];
  const boss = createBoss(TUNING.boss, 1e9, W, H, 0);   // ずっと居るボス
  const state = { shots: [], shotT: 99, timeLeft: 60, monsters: [], reflects: 0, shotHits: 0, shake: 0, flashRed: 0, attackHinted: true, cracks: [], feverT: 0 };
  const attacks = createAttacks({
    TUNING, MON, S: { attack: true, diff: 'normal', two }, state, ...stubFx,
    isBossActive: () => boss.hp > 0, getBossPos: () => ({ x: boss.x, y: boss.y }),
    onBossReflectHit: s => Math.hypot(s.x - boss.x, s.y - boss.y) <= TUNING.boss.radius + s.r && reflectDamageBoss(boss, TUNING.boss).applied,
    addScore: (pi, v) => { scores[pi] += v; }, playerIndexForPtr: p => two && p === ptrs[1] ? 1 : 0, playerIndexForX: x => playerIndexForX(x, W, two),
  });
  const spawnMon = i => ({ type: types[i % types.length], r: 30, hr: 30, x: (i * 67) % W, y: H + 20, vx: (i % 5 - 2) * 40, vy: -600, g: 520, age: 0, dead: false });
  state.monsters = Array.from({ length: TUNING.maxMonsters }, (_, i) => spawnMon(i));
  const gestures = two ? [createGestureState(), createGestureState()] : [createGestureState()];
  const ghostPrev = two ? null : unpackGhost(packGhost(Array.from({ length: 600 }, (_, i) => createGhostSample(i * 0.1, [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }], i * 10))));
  const ghostRec = [];
  let elapsed = 0;
  for (let f = 0; f < frames; f++) {
    const t0 = performance.now();
    elapsed += dt;
    // にせAI: 2人なら手4つ、1人なら手2つ（毎コマ、ランドマークを作り直す）
    const n = two ? 4 : 2, hands = [];
    for (let i = 0; i < n; i++) hands.push(makeHand({ cx: 120 + i * (W - 240) / (n - 1) + Math.sin(elapsed * 3 + i) * 40, cy: 200, size: 120 + i * 10, bentCount: (f + i) % 5 }));
    const picked = two ? selectTwoPlayerHands(hands, { width: W, minPx: TUNING.boothMinHandPx, centerDeadZone: TUNING.two.centerDeadZone }) : hands.slice(0, 2);
    picked.forEach((h, i) => { if (!h) return; h.shape = classifyHandShape(h.raw, TUNING.gesture); const p = ptrs[i]; p.ox = p.x; p.oy = p.y; p.x = h.pts[8].x; p.y = h.pts[8].y; });
    // ボス・ボスの火の玉（2発まで）
    updateBoss(boss, dt, TUNING.boss, W);
    const active = state.shots.filter(s => s.fromBoss && s.st !== 'back').length;
    if (updateBossShots(boss, elapsed, TUNING.boss, active) === 'launch') attacks.launchShot({ forceFrom: boss, windup: TUNING.boss.telegraph, radius: TUNING.boss.radius });
    attacks.updateAttacks(dt);
    // てき（上限いっぱい）の動きと当たり判定
    for (let i = 0; i < state.monsters.length; i++) {
      const m = state.monsters[i];
      m.age += dt; m.vy += m.g * dt; m.x += m.vx * dt; m.y += m.vy * dt;
      for (const p of ptrs) if (p.active && segDist(p.ox, p.oy, p.x, p.y, m.x, m.y) <= m.hr + 15) { scores[ptrs.indexOf(p) && two ? 1 : 0] += 10 * comboMultiplier(3, false); }
      if (m.y > H + 90 && m.vy > 0) state.monsters[i] = spawnMon(f + i);
    }
    for (const p of ptrs) {
      const speed = Math.hypot(p.x - p.ox, p.y - p.oy) / dt;
      if (segDist(p.ox, p.oy, p.x, p.y, boss.x, boss.y) <= TUNING.boss.radius) damageBoss(boss, speed, TUNING.boss, p === ptrs[0] ? 'p1' : 'p2');
      for (const s of state.shots) if (s.st === 'fly' && gestures.some(g => shotInsideShield(s.x, s.y, g, TUNING.gesture.shieldRadius))) s.gone = true;
    }
    // 手の技（グー演出: 5びょうごとに全体攻撃）
    gestures.forEach((g, pi) => {
      const h = picked[pi] || picked[0];
      updateHold(g.fist, !!h && h.shape === 'fist', dt, TUNING.gesture.graceMs);
      updateHold(g.open, !!h && h.shape === 'open', dt, TUNING.gesture.graceMs);
      updateShieldTimers(g, dt); tryActivateShield(g, TUNING.gesture);
      if (f % 300 === 0) { g.gauge = 100; g.fist.held = TUNING.gesture.fistHold; }
      if (consumeFist(g, TUNING.gesture)) { for (const m of state.monsters) m.dead = true; state.monsters = state.monsters.map((_, i) => spawnMon(f + i)); damageBossFlat(boss, TUNING.gesture.fistBossDamage, TUNING.boss); }
    });
    // ゴースト（1人のときだけ）
    if (ghostPrev) {
      sampleGhost(ghostPrev, elapsed);
      if (f % 6 === 0) ghostRec.push(createGhostSample(elapsed, ptrs.map(p => normalizeGhostPoint(p.x, p.y, W, H)), scores[0]));
    }
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const q = k => times[Math.min(times.length - 1, Math.floor(times.length * k))];
  return { p50: q(0.5), p95: q(0.95), max: times[times.length - 1], shotsSeen: state.reflects + state.shotHits };
}

test('perf (logic only): one and two players with many enemies, the boss, 2 fireballs, ghost and fist effects stay under 16.7ms p95', t => {
  simulateFrames({ two: false, frames: 600 });   // 準備運動（JIT）
  for (const two of [false, true]) {
    const r = simulateFrames({ two, frames: 3600 });   // 60びょうぶん
    t.diagnostic(`${two ? '2人' : '1人'}: p50=${r.p50.toFixed(4)}ms p95=${r.p95.toFixed(4)}ms max=${r.max.toFixed(3)}ms`);
    assert.ok(r.p95 < 16.7, `p95 ${r.p95}ms`);
  }
});
