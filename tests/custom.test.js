import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from '../src/config.js';
import { applyCustom, defaultCustom, isCustomized, sanitizeCustom, stepCustom } from '../src/game/custom.js';
import { MON_BASE, describe } from '../src/game/monsters.js';

const clone = o => JSON.parse(JSON.stringify(o));
const BOSS = { ...TUNING.boss };

test('改造していないときの数字は、元のモンスターとボスの数字', () => {
  const d = defaultCustom(MON_BASE, BOSS);
  assert.deepEqual(d.golem, { hp: 3, pts: 100, size: 100, speed: 100, freq: 100 });
  assert.deepEqual(d.bomb, { size: 100, speed: 100, freq: 100 });   // ばくだんは体力・点数なし
  assert.deepEqual(d.boss, { hp: BOSS.hp, pts: BOSS.bonus, speed: 100 });
  assert.equal(isCustomized(d, d), false);
});

test('保存してあった数字は、こわれていたら元にもどし、はんいの外なら はしに合わせる', () => {
  const d = defaultCustom(MON_BASE, BOSS);
  const s = sanitizeCustom({ slime: { hp: 999, pts: 'abc', size: 10 }, ghost: null, boss: { hp: -5 }, ufo: { hp: 3 } }, d);
  assert.equal(s.slime.hp, 20); assert.equal(s.slime.pts, 10); assert.equal(s.slime.size, 50);
  assert.deepEqual(s.ghost, d.ghost);
  assert.equal(s.boss.hp, 50);
  assert.equal('ufo' in s, false);
  assert.deepEqual(sanitizeCustom(null, d), d);
});

test('＋ − ボタンで となりの値へ進み、はしでは止まる', () => {
  assert.equal(stepCustom('golem', 'hp', 3, 1), 4);
  assert.equal(stepCustom('golem', 'hp', 3, -1), 2);
  assert.equal(stepCustom('slime', 'hp', 1, -1), 1);
  assert.equal(stepCustom('slime', 'freq', 100, -1), 50);
  assert.equal(stepCustom('slime', 'freq', 25, -1), 0);
  assert.equal(stepCustom('boss', 'hp', 150, 1), 200);   // ボスの体力は大きな値で進む
  assert.equal(stepCustom('slime', 'pts', 1000, 1), 1000);
});

test('改造した数字が、モンスターのデータとボスの設定に入り、元にもどせる', () => {
  const mon = clone(MON_BASE), boss = { ...BOSS }, d = defaultCustom(MON_BASE, BOSS), cfg = clone(d);
  cfg.slime.hp = 3; cfg.slime.pts = 200; cfg.bat.size = 200; cfg.ghost.speed = 50; cfg.bomb.freq = 0; cfg.boss.hp = 500; cfg.boss.speed = 150;
  assert.equal(isCustomized(cfg, d), true);
  applyCustom(cfg, mon, MON_BASE, boss, BOSS);
  assert.deepEqual([mon.slime.hp, mon.slime.pts], [3, 200]);
  assert.deepEqual([mon.bat.r, mon.bat.hr], [MON_BASE.bat.r * 2, MON_BASE.bat.hr * 2]);   // 当たりの広さもいっしょに大きくなる
  assert.equal(mon.ghost.speed, 0.5); assert.equal(mon.bomb.freq, 0);
  assert.equal(boss.hp, 500); assert.equal(boss.moveSpeed, Math.round(BOSS.moveSpeed * 1.5)); assert.equal(boss.dashSpeed, Math.round(BOSS.dashSpeed * 1.5));
  assert.equal(describe(mon.slime), '200点・3回あてる');
  applyCustom(d, mon, MON_BASE, boss, BOSS);
  assert.deepEqual(mon, MON_BASE);
  assert.deepEqual(boss, BOSS);
  assert.equal(describe(mon.golem), '100点・3回あてる');
  assert.equal(describe(mon.ghost), '20点・よこにうごく');
});
