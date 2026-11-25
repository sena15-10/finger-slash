function validNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function createGhostSample(time, pointers, score, interval) {
  return {
    t: Math.round(time / interval) * interval,
    p: pointers.map(pointer => ({ x: Math.round(pointer.x), y: Math.round(pointer.y) })),
    s: Math.round(score),
  };
}

export function packGhost(samples, tuning) {
  if (!samples.length) return null;
  const strideSamples = stride => samples
    .filter((_, index) => index === 0 || index === samples.length - 1 || index % stride === 0)
    .map(sample => [
      Math.round(sample.t / tuning.interval),
      Math.round(sample.p[0].x),
      Math.round(sample.p[0].y),
      Math.round(sample.p[1].x),
      Math.round(sample.p[1].y),
      Math.round(sample.s),
    ]);

  let stride = 1;
  let packed = { version: 1, samples: strideSamples(stride) };
  while (JSON.stringify(packed).length * 2 > tuning.maxBytes && stride < samples.length) {
    stride *= 2;
    packed = { version: 1, samples: strideSamples(stride) };
  }
  if (JSON.stringify(packed).length * 2 > tuning.maxBytes) {
    throw new RangeError('Ghost recording exceeds the configured storage limit');
  }
  return packed;
}

export function unpackGhost(value, tuning) {
  if (!value || value.version !== 1 || !Array.isArray(value.samples)) return null;
  const samples = [];
  let previousTime = -1;
  for (const row of value.samples) {
    if (!Array.isArray(row) || row.length !== 6 || !row.every(validNumber)) continue;
    const time = row[0] * tuning.interval;
    if (time < 0 || time <= previousTime) continue;
    samples.push({
      t: time,
      p: [{ x: row[1], y: row[2] }, { x: row[3], y: row[4] }],
      s: row[5],
    });
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
  return {
    t: time,
    p: before.p.map((point, index) => ({
      x: point.x + (after.p[index].x - point.x) * ratio,
      y: point.y + (after.p[index].y - point.y) * ratio,
    })),
    s: before.s + (after.s - before.s) * ratio,
  };
}

export function ghostResultText(score, samples) {
  if (!samples || !samples.length) return '';
  const previousScore = samples[samples.length - 1].s;
  if (score > previousScore) return '前の人をこえた！';
  if (score < previousScore) return `あと${previousScore - score}点で前の人こえ`;
  return '前の人と同点！';
}
