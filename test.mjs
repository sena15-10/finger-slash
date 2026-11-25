import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from './src/config.js';
import { bossHpPercent, createBoss, damageBoss, damageBossFlat, reflectDamageBoss, shouldSpawnBoss, updateBoss, updateBossShots } from './src/game/boss.js';
import { createAttacks } from './src/game/attacks.js';
import { createGhostSample, ghostResultText, packGhost, sampleGhost, unpackGhost } from './src/game/ghost.js';

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

test('ghost storage round-trips coordinate and score data within the configured size cap', () => {
  const samples = Array.from({ length: TUNING.ghost.maxSamples }, (_, index) =>
    createGhostSample(index * TUNING.ghost.interval, [{ x: index % 960, y: 270 }, { x: 700, y: 400 }], index * 1000, TUNING.ghost.interval));
  const packed = packGhost(samples, TUNING.ghost);
  const serialized = JSON.stringify(packed);
  const restored = unpackGhost(JSON.parse(serialized), TUNING.ghost);
  assert.ok(serialized.length * 2 <= TUNING.ghost.maxBytes);
  assert.equal(restored[0].t, 0);
  assert.equal(restored[restored.length - 1].t, samples[samples.length - 1].t);
  assert.equal(restored[restored.length - 1].s, samples[samples.length - 1].s);
  assert.equal(serialized.includes('name'), false);
  assert.equal(serialized.includes('face'), false);
  assert.equal(serialized.includes('video'), false);
});

test('ghost result explains whether the previous player was passed', () => {
  const previous = [{ t: 0, p: [{ x: 0, y: 0 }, { x: 0, y: 0 }], s: 500 }];
  assert.equal(ghostResultText(600, previous), '前の人をこえた！');
  assert.equal(ghostResultText(450, previous), 'あと50点で前の人こえ');
  assert.equal(ghostResultText(500, previous), '前の人と同点！');
});
