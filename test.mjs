import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from './src/config.js';
import { createBoss, damageBoss, shouldSpawnBoss, updateBoss } from './src/game/boss.js';
import { createAttacks } from './src/game/attacks.js';
import { createGhostSample, ghostResultText, packGhost, sampleGhost, unpackGhost } from './src/game/ghost.js';

test('boss appears once when the remaining round time reaches its threshold', () => {
  assert.equal(shouldSpawnBoss(true, false, TUNING.boss.appearAt + 0.1, TUNING.boss.appearAt), false);
  assert.equal(shouldSpawnBoss(true, false, TUNING.boss.appearAt, TUNING.boss.appearAt), true);
  assert.equal(shouldSpawnBoss(true, true, 0, TUNING.boss.appearAt), false);
  assert.equal(shouldSpawnBoss(false, false, 0, TUNING.boss.appearAt), false);
});

test('slow slashes and hits inside the cooldown do not damage the boss', () => {
  const boss = createBoss(TUNING.boss, 960);
  assert.equal(damageBoss(boss, TUNING.boss.minSpeed - 1, TUNING.boss).applied, false);
  assert.equal(boss.hp, TUNING.boss.hp);

  assert.equal(damageBoss(boss, TUNING.boss.minSpeed, TUNING.boss).applied, true);
  assert.equal(damageBoss(boss, TUNING.boss.minSpeed, TUNING.boss).applied, false);
  assert.equal(boss.hp, TUNING.boss.hp - TUNING.boss.damage);
});

test('boss patrol remains inside the arena bounds', () => {
  const boss = createBoss(TUNING.boss, 960);
  boss.x = 960 - TUNING.boss.radius;
  boss.y = 540 - TUNING.boss.radius;
  boss.vx = Math.abs(boss.vx);
  boss.vy = Math.abs(boss.vy);
  updateBoss(boss, 0.01, TUNING.boss, 960, 540);
  assert.equal(boss.x, 960 - TUNING.boss.radius);
  assert.equal(boss.y, 540 - TUNING.boss.radius);
  assert.ok(boss.vx < 0);
  assert.ok(boss.vy < 0);
});

test('boss dashes toward new points, slows down afterward, and gets faster when hurt', () => {
  const boss = createBoss(TUNING.boss, 960);
  assert.notEqual(boss.vx, 0);
  assert.notEqual(boss.vy, 0);
  const seq = [0.5, 0.0, 1.0];   // 左上へダッシュ
  let k = 0; const random = () => seq[k++ % seq.length];
  boss.x = 480; boss.y = 270;
  boss.dashTimer = 0.001;
  updateBoss(boss, 1 / 60, TUNING.boss, 960, 540, random);
  const dashSpeed = Math.hypot(boss.vx, boss.vy);
  assert.ok(dashSpeed > TUNING.boss.moveSpeed * 2.5, `dash=${dashSpeed}`);
  for (let i = 0; i < 30; i++) updateBoss(boss, 1 / 60, TUNING.boss, 960, 540, () => 0.99);
  assert.ok(Math.hypot(boss.vx, boss.vy) < dashSpeed, 'slows after a dash');

  const calm = createBoss(TUNING.boss, 960), angry = createBoss(TUNING.boss, 960);
  angry.hp = 10;
  for (const b of [calm, angry]) { b.dashTimer = 99; b.speed = TUNING.boss.moveSpeed; updateBoss(b, 1, TUNING.boss, 960, 540); }
  assert.ok(Math.hypot(angry.vx, angry.vy) > Math.hypot(calm.vx, calm.vy) * 1.3);

  const hit = createBoss(TUNING.boss, 960);
  hit.dashTimer = 5;
  damageBoss(hit, TUNING.boss.minSpeed, TUNING.boss);
  assert.ok(hit.dashTimer <= TUNING.boss.hitDashDelay, 'runs away right after a hit');

  // 5びょう（ボスが出ている時間）のあいだに、画面から出ずに広く動き回る
  let seed = 7; const seeded = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const patrol = createBoss(TUNING.boss, 960), r = TUNING.boss.radius;
  let minX = 960, maxX = 0, minY = 540, maxY = 0;
  for (let frame = 0; frame < 300; frame++) {
    updateBoss(patrol, 1 / 60, TUNING.boss, 960, 540, seeded);
    assert.ok(patrol.x >= r && patrol.x <= 960 - r && patrol.y >= r && patrol.y <= 540 - r);
    minX = Math.min(minX, patrol.x); maxX = Math.max(maxX, patrol.x); minY = Math.min(minY, patrol.y); maxY = Math.max(maxY, patrol.y);
  }
  assert.ok(maxX - minX > (960 - 2 * r) * 0.5, `x range ${maxX - minX}`);
  assert.ok(maxY - minY > (540 - 2 * r) * 0.5, `y range ${maxY - minY}`);
});

test('enemy attacks are suppressed while the boss is alive', () => {
  const attackState = { shots: [{ st: 'fly' }], shotT: 0, timeLeft: 5 };
  const attacks = createAttacks({
    TUNING, MON: {}, S: { attack: true, diff: 'normal' }, state: attackState,
    isBossActive: () => true,
  });
  attacks.updateAttacks(0.1);
  assert.deepEqual(attackState.shots, []);
  assert.equal(attackState.shotT, 0);
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
