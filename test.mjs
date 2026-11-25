import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from './src/config.js';
import { createBoss, damageBoss, shouldSpawnBoss, updateBoss } from './src/game/boss.js';
import { createAttacks } from './src/game/attacks.js';

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
  updateBoss(boss, 1, TUNING.boss, 960);
  assert.equal(boss.x, 960 - TUNING.boss.radius);
  assert.equal(boss.direction, -1);
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
