import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from '../src/config.js';
import { addComebackDamage, comebackActive, comebackEnabled, createComeback, tickComeback } from '../src/game/comeback.js';
import { rankForScore } from '../src/game/scoring.js';

const cfg = { difficulties: ['extreme'], gaugeMax: 3, seconds: 6 };

test('逆転ゲージは激ムズだけで使う', () => {
  assert.equal(comebackEnabled(TUNING.comeback, 'extreme'), true);
  for (const d of ['easy', 'normal', 'hard']) assert.equal(comebackEnabled(TUNING.comeback, d), false);
});

test('3回当たると逆転タイムが始まり、ゲージは空にもどる', () => {
  const st = createComeback();
  assert.equal(addComebackDamage(st, cfg), false);
  assert.equal(addComebackDamage(st, cfg), false);
  assert.equal(st.gauge, 2);
  assert.equal(addComebackDamage(st, cfg), true);
  assert.equal(st.gauge, 0);
  assert.equal(comebackActive(st), true);
});

test('逆転タイム中はゲージがたまらず、時間がたつと終わる', () => {
  const st = createComeback();
  for (let i = 0; i < 3; i++) addComebackDamage(st, cfg);
  assert.equal(addComebackDamage(st, cfg), false);
  assert.equal(st.gauge, 0);
  tickComeback(st, 5.9); assert.equal(comebackActive(st), true);
  tickComeback(st, 0.2); assert.equal(comebackActive(st), false);
});

test('激ムズは、ばくだん・火の玉が「むずかしい」より多く、ランクの基準も高い', () => {
  const D = TUNING.difficulty, A = TUNING.attacks;
  assert.ok(D.extreme.bomb > D.hard.bomb && D.extreme.maxBombs > D.hard.maxBombs);
  assert.ok(A.interval.extreme[1] < A.interval.hard[0]);
  assert.ok(A.maxAtOnce.extreme > A.maxAtOnce.hard && A.volley.extreme > 1);
  assert.equal(rankForScore(4500, 60, 'hard'), 'S');
  assert.equal(rankForScore(4500, 60, 'extreme'), 'A');
});
