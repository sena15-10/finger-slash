import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboMultiplier, rankForScore } from '../src/game/scoring.js';

test('combo multiplier increases every five hits and doubles during fever', () => {
  assert.equal(comboMultiplier(1, false), 1);
  assert.equal(comboMultiplier(6, false), 2);
  assert.equal(comboMultiplier(30, false), 5);
  assert.equal(comboMultiplier(6, true), 4);
});

test('rank thresholds scale with round duration and difficulty', () => {
  assert.equal(rankForScore(3600, 60, 'normal'), 'S');
  assert.equal(rankForScore(3599, 60, 'normal'), 'A');
  assert.equal(rankForScore(2880, 60, 'easy'), 'S');
  assert.equal(rankForScore(4500, 60, 'hard'), 'S');
  assert.equal(rankForScore(0, 30, 'normal'), 'D');
});
