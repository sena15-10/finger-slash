import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from '../src/config.js';
import { decideSpecial, pickCoopHands } from '../src/game/coop.js';
import { ghostResultText } from '../src/game/ghost.js';
import { createGestureTracker, updateGesture } from '../src/input/gesture.js';
import { rankForScore } from '../src/game/scoring.js';

// 手首を (x, y) にした、上向きの手（21点）。open[i] が true の指はのばし、false の指はにぎる
function makeHand(open, x = 400, y = 300) {
  const pts = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  [[1, -30, -20], [2, -45, -40], [3, -55, -55], [4, -60, -70]].forEach(([i, px, py]) => { pts[i] = { x: px, y: py }; });
  [-24, -8, 8, 24].forEach((fx, f) => {
    const base = 5 + f * 4;
    pts[base] = { x: fx, y: -60 }; pts[base + 1] = { x: fx, y: -90 };
    if (open[f]) { pts[base + 2] = { x: fx, y: -110 }; pts[base + 3] = { x: fx, y: -130 }; }
    else { pts[base + 2] = { x: fx, y: -75 }; pts[base + 3] = { x: fx, y: -55 }; }
  });
  return pts.map(p => ({ x: x + p.x, y: y + p.y }));
}
const PEACE = [true, true, false, false], FIST = [false, false, false, false];
const hand = (x, size) => ({ pts: [{ x, y: 300 }], size });

test('ふたりモードの手は、画面の左右から1つずつ大きい手をえらぶ', () => {
  const a = hand(100, 90), a2 = hand(300, 80), b = hand(700, 40);   // 左の人が両手を出し、右の人は小さく写っている
  assert.deepEqual(pickCoopHands([a2, b, a], 960), [a, b]);
  assert.deepEqual(pickCoopHands([a2, a], 960), [a, a2]);   // 左にしかいなければ、1人で2つの手を使える
  assert.deepEqual(pickCoopHands([b], 960), [b]);
  assert.deepEqual(pickCoopHands([], 960), []);
});

// それぞれの手の形を、t びょうの間 止めたまま見せる
function hold(trackers, shapes, seconds, t0 = 0) {
  let t = t0;
  for (; t <= t0 + seconds + 1e-9; t += 1 / 30) trackers.forEach((tr, i) => updateGesture(tr, shapes[i] ? [makeHand(shapes[i], 200 + i * 400)] : [], t, TUNING.special));
  return t;
}

test('ふたりが同じ形で止めると合体技、ひとりのときは あいぼうを待ってから ふつうの技', () => {
  const cfg = TUNING.special, opt = { coop: true, waitSeconds: 1 };
  const pair = [createGestureTracker(), createGestureTracker()];
  hold(pair, [PEACE, PEACE], cfg.holdSeconds + 0.05);
  const d = decideSpecial(pair, cfg, opt);
  assert.equal(d.merged, true); assert.equal(d.kind, 'peace'); assert.equal(d.trackers.length, 2);

  const alone = [createGestureTracker(), createGestureTracker()];
  const t = hold(alone, [FIST, null], cfg.holdSeconds + 0.1);
  assert.equal(decideSpecial(alone, cfg, opt), null);   // まだ あいぼうを待っている
  hold(alone, [FIST, null], 1, t);
  const late = decideSpecial(alone, cfg, opt);
  assert.equal(late.merged, false); assert.equal(late.kind, 'fist');

  const diff = [createGestureTracker(), createGestureTracker()];   // ちがう形どうしは合体しない
  hold(diff, [PEACE, FIST], cfg.holdSeconds + 0.05);
  assert.equal(decideSpecial(diff, cfg, opt), null);
});

test('ひとりモードでは待たずに すぐ技が出て、合体技にはならない', () => {
  const cfg = TUNING.special, trs = [createGestureTracker(), createGestureTracker()];
  hold(trs, [PEACE, PEACE], cfg.holdSeconds + 0.05);
  const d = decideSpecial(trs, cfg, { coop: false, waitSeconds: 1 });
  assert.equal(d.merged, false); assert.equal(d.kind, 'peace');
  assert.equal(decideSpecial([createGestureTracker()], cfg), null);
});

test('ふたりモードはランクの基準が上がり、ゴーストの相手は「前のペア」になる', () => {
  assert.equal(rankForScore(3600, 60, 'normal'), 'S');
  assert.equal(rankForScore(3600, 60, 'normal', TUNING.coop.rankScale), 'A');
  assert.equal(rankForScore(3600 * TUNING.coop.rankScale, 60, 'normal', TUNING.coop.rankScale), 'S');
  const prev = [{ t: 0, s: 0, p: [] }, { t: 1, s: 500, p: [] }];
  assert.equal(ghostResultText(600, prev, '前のペア'), '前のペアをこえた！');
  assert.equal(ghostResultText(450, prev), 'あと50点で前の人こえ');
});
