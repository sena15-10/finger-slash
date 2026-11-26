import assert from 'node:assert/strict';
import test from 'node:test';
import { TUNING } from '../src/config.js';
import { createBoss, punchBoss } from '../src/game/boss.js';
import { classifyHand, consumeGesture, createGestureTracker, gestureReady, updateGesture } from '../src/input/gesture.js';

// 手首を原点にした、上向きの手（21点）を作る。open[i] が true の指はのばし、false の指はにぎる
function makeHand(open, { scale = 1, angle = 0, x = 400, y = 300 } = {}) {
  const pts = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  [[1, -30, -20], [2, -45, -40], [3, -55, -55], [4, -60, -70]].forEach(([i, px, py]) => { pts[i] = { x: px, y: py }; });   // 親指
  [-24, -8, 8, 24].forEach((fx, f) => {
    const base = 5 + f * 4;
    pts[base] = { x: fx, y: -60 };       // つけね
    pts[base + 1] = { x: fx, y: -90 };   // 第2関節
    if (open[f]) { pts[base + 2] = { x: fx, y: -110 }; pts[base + 3] = { x: fx, y: -130 }; }
    else { pts[base + 2] = { x: fx, y: -75 }; pts[base + 3] = { x: fx, y: -55 }; }   // 指先が手のひら側にもどる
  });
  const c = Math.cos(angle), s = Math.sin(angle);
  return pts.map(p => ({ x: x + (p.x * c - p.y * s) * scale, y: y + (p.x * s + p.y * c) * scale }));
}
const OPEN = [true, true, true, true], PEACE = [true, true, false, false], FIST = [false, false, false, false], POINT = [true, false, false, false];

test('パー・ピース・グーを見分け、人さし指だけのときは何もしない', () => {
  assert.equal(classifyHand(makeHand(OPEN)), 'open');
  assert.equal(classifyHand(makeHand(PEACE)), 'peace');
  assert.equal(classifyHand(makeHand(FIST)), 'fist');
  assert.equal(classifyHand(makeHand(POINT)), null);
  assert.equal(classifyHand(null), null);
});

test('手の大きさや向きが変わっても、同じ形と判定する', () => {
  for (const opt of [{ scale: 0.4 }, { scale: 2.5 }, { angle: Math.PI / 2 }, { angle: -2.4, scale: 1.7 }]) {
    assert.equal(classifyHand(makeHand(OPEN, opt)), 'open');
    assert.equal(classifyHand(makeHand(PEACE, opt)), 'peace');
    assert.equal(classifyHand(makeHand(FIST, opt)), 'fist');
  }
});

test('形を作って手を止めると発動OKになり、動かしている間はならない', () => {
  const cfg = TUNING.special, still = createGestureTracker();
  for (let t = 0; t <= cfg.holdSeconds + 0.05; t += 1 / 30) updateGesture(still, [makeHand(PEACE)], t, cfg);
  assert.equal(gestureReady(still, cfg), true);
  assert.equal(still.kind, 'peace');

  const moving = createGestureTracker();   // 手のひらを開いたまま速く斬っている
  for (let i = 0; i < 30; i++) updateGesture(moving, [makeHand(OPEN, { x: 100 + i * 40 })], i / 30, cfg);
  assert.equal(gestureReady(moving, cfg), false);
});

test('発動したあとは、手の形を変えるまで同じ技が出ない', () => {
  const cfg = TUNING.special, tr = createGestureTracker();
  let t = 0;
  const hold = shape => { for (let i = 0; i < 20; i++, t += 1 / 30) updateGesture(tr, [makeHand(shape)], t, cfg); };
  hold(FIST); assert.equal(gestureReady(tr, cfg), true);
  consumeGesture(tr);
  hold(FIST); assert.equal(gestureReady(tr, cfg), false);
  updateGesture(tr, [], t += 1 / 30, cfg);   // 手をはなす（または形を変える）
  hold(FIST); assert.equal(gestureReady(tr, cfg), true);
});

test('グーのゲンコツは、斬る速さやクールタイムに関係なくボスに大ダメージ', () => {
  const boss = createBoss(TUNING.boss, 960);
  boss.hitCooldown = 1;
  const r = punchBoss(boss, TUNING.special.punchDamage, TUNING.boss);
  assert.equal(r.applied, true);
  assert.equal(boss.hp, TUNING.boss.hp - TUNING.special.punchDamage);
  boss.hp = 20;
  const last = punchBoss(boss, TUNING.special.punchDamage, TUNING.boss);
  assert.deepEqual([last.defeated, last.damage, last.bonus], [true, 20, TUNING.boss.bonus]);
  assert.equal(punchBoss(boss, 10, TUNING.boss).applied, false);
});
