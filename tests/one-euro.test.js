import assert from 'node:assert/strict';
import test from 'node:test';
import { createOneEuro2D } from '../src/input/one-euro.js';

// 決まった乱数（毎回同じ結果にする）
function noise(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; }; }

test('止めている手の小さなゆれを小さくする', () => {
  const f = createOneEuro2D({ minCutoff: 1.2, beta: 0.005 }), r = noise(1);
  let rawSpread = 0, outSpread = 0;
  for (let i = 0; i < 120; i++) {
    const x = 400 + r() * 8, y = 300 + r() * 8, o = f.filter(x, y, i / 30);
    if (i > 30) { rawSpread += (x - 400) ** 2; outSpread += (o.x - 400) ** 2; }
  }
  rawSpread = Math.sqrt(rawSpread); outSpread = Math.sqrt(outSpread);
  assert.ok(outSpread < rawSpread * 0.5, `out=${outSpread} raw=${rawSpread}`);
});

test('速く動かしたときは大きく遅れない', () => {
  const f = createOneEuro2D({ minCutoff: 1.2, beta: 0.005 });
  let o;
  for (let i = 0; i <= 15; i++) o = f.filter(100 + i * 50, 300, i / 30);   // 1500ピクセル/秒
  assert.ok(850 - o.x < 60, `lag=${850 - o.x}`);
});

test('最初の値はそのまま返し、同じ時刻の値は無視する', () => {
  const f = createOneEuro2D();
  assert.deepEqual(f.filter(10, 20, 1), { x: 10, y: 20 });
  assert.deepEqual(f.filter(500, 500, 1), { x: 10, y: 20 });
});
