function validNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// 座標は0〜1（小数第3位まで）にして保存する。表示のときに、そのときの幅・高さを掛ける
export function normalizeGhostPoint(x, y, width, height) {
  const nx = width > 0 ? Math.min(1, Math.max(0, x / width)) : 0;
  const ny = height > 0 ? Math.min(1, Math.max(0, y / height)) : 0;
  return { x: Math.round(nx * 1000) / 1000, y: Math.round(ny * 1000) / 1000 };
}

export function createGhostSample(time, points, score) {
  return { t: time, p: points, s: Math.round(score) };
}

// 手が一度も検出されなかったラウンド（すべてのpが空）かどうか
export function hasAnyHand(samples) {
  return samples.some(sample => sample.p.length > 0);
}

export function packGhost(samples) {
  if (!samples || !samples.length) return null;
  return { version: 2, samples: samples.map(s => [s.t, s.p.map(p => [p.x, p.y]), s.s]) };
}

export function unpackGhost(value) {
  if (!value || value.version !== 2 || !Array.isArray(value.samples)) return null;
  const samples = [];
  let previousTime = -Infinity;
  for (const row of value.samples) {
    if (!Array.isArray(row) || row.length !== 3) continue;
    const [time, pts, score] = row;
    if (!validNumber(time) || time <= previousTime || !validNumber(score) || !Array.isArray(pts)) continue;
    const points = [];
    let ok = true;
    for (const pt of pts) {
      if (!Array.isArray(pt) || pt.length !== 2 || !validNumber(pt[0]) || !validNumber(pt[1])) { ok = false; break; }
      points.push({ x: pt[0], y: pt[1] });
    }
    if (!ok) continue;
    samples.push({ t: time, p: points, s: score });
    previousTime = time;
  }
  return samples.length ? samples : null;
}

export function sampleGhost(samples, time) {
  if (!samples || !samples.length) return null;
  if (time <= samples[0].t) return samples[0];
  const last = samples[samples.length - 1];
  if (time >= last.t) return last;

  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t < time) low = middle + 1;
    else high = middle;
  }
  const after = samples[low];
  const before = samples[low - 1];
  const ratio = (time - before.t) / (after.t - before.t);
  const handCount = Math.min(before.p.length, after.p.length);
  const points = [];
  for (let i = 0; i < handCount; i++) {
    points.push({
      x: before.p[i].x + (after.p[i].x - before.p[i].x) * ratio,
      y: before.p[i].y + (after.p[i].y - before.p[i].y) * ratio,
    });
  }
  return { t: time, p: points, s: before.s + (after.s - before.s) * ratio };
}

export function ghostResultText(score, samples) {
  if (!samples || !samples.length) return '';
  const previousScore = samples[samples.length - 1].s;
  if (score > previousScore) return '前の人をこえた！';
  if (score < previousScore) return `あと${previousScore - score}点で前の人こえ`;
  return '前の人と同点！';
}
