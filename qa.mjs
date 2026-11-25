import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from './src/config.js';
import { createBoss, damageBoss, updateBoss } from './src/game/boss.js';
import { createGhostSample, packGhost, sampleGhost, unpackGhost } from './src/game/ghost.js';

test('boss can be defeated in fifteen cooldown-spaced slashes for a flat bonus', () => {
  const boss = createBoss(TUNING.boss, 960);
  let bonus = 0;
  for (let hit = 0; hit < TUNING.boss.hp / TUNING.boss.damage; hit++) {
    const result = damageBoss(boss, TUNING.boss.minSpeed, TUNING.boss);
    assert.equal(result.applied, true);
    bonus += result.bonus;
    updateBoss(boss, TUNING.boss.hitCooldown, TUNING.boss, 960);
  }

  assert.equal(boss.hp, 0);
  assert.equal(bonus, TUNING.boss.bonus);
  assert.equal(damageBoss(boss, TUNING.boss.minSpeed, TUNING.boss).applied, false);
});

test('a second-round ghost can be restored and replayed at its matching timestamp', () => {
  const current = [
    createGhostSample(0, [{ x: 40, y: 60 }, { x: 80, y: 100 }], 0, TUNING.ghost.interval),
    createGhostSample(0.1, [{ x: 60, y: 80 }, { x: 100, y: 120 }], 50, TUNING.ghost.interval),
    createGhostSample(0.2, [{ x: 80, y: 100 }, { x: 120, y: 140 }], 100, TUNING.ghost.interval),
  ];
  const previousPlayer = unpackGhost(packGhost(current, TUNING.ghost), TUNING.ghost);
  const replay = sampleGhost(previousPlayer, 0.15);
  assert.deepEqual(replay.p, [{ x: 70, y: 90 }, { x: 110, y: 130 }]);
  assert.equal(replay.s, 75);
});
