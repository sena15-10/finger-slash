import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from './src/config.js';
import { createBoss, damageBoss, updateBoss } from './src/game/boss.js';

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
