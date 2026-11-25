import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from './src/config.js';
import { createBoss, damageBoss, updateBoss } from './src/game/boss.js';
import { createGhostSample, packGhost, sampleGhost, unpackGhost } from './src/game/ghost.js';

test('boss can be defeated in fifteen cooldown-spaced slashes for a flat bonus', () => {
  const boss = createBoss(TUNING.boss, TUNING.boss.hp[30], 960, 540, 0);
  let bonus = 0;
  for (let hit = 0; hit < TUNING.boss.hp[30] / TUNING.boss.slashDamage; hit++) {
    const result = damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p1');
    assert.equal(result.applied, true);
    bonus += result.bonus;
    updateBoss(boss, TUNING.boss.slashCooldown, TUNING.boss, 960);
  }

  assert.equal(boss.hp, 0);
  assert.equal(bonus, TUNING.boss.defeatBonus);
  assert.equal(damageBoss(boss, TUNING.boss.minSlashSpeed, TUNING.boss, 'p1').applied, false);
});

test('a second-round ghost can be restored and replayed at its matching timestamp', () => {
  const current = [
    createGhostSample(0, [{ x: 0.04, y: 0.06 }, { x: 0.08, y: 0.1 }], 0),
    createGhostSample(0.1, [{ x: 0.06, y: 0.08 }, { x: 0.1, y: 0.12 }], 50),
    createGhostSample(0.2, [{ x: 0.08, y: 0.1 }, { x: 0.12, y: 0.14 }], 100),
  ];
  const previousPlayer = unpackGhost(packGhost(current));
  const replay = sampleGhost(previousPlayer, 0.15);
  const round3 = n => Math.round(n * 1000) / 1000;
  assert.deepEqual(replay.p.map(p => ({ x: round3(p.x), y: round3(p.y) })), [{ x: 0.07, y: 0.09 }, { x: 0.11, y: 0.13 }]);
  assert.equal(replay.s, 75);
});
