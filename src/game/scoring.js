export function comboMultiplier(combo, feverActive) {
  const comboMultiplier = Math.min(5, 1 + Math.floor((combo - 1) / 5));
  return comboMultiplier * (feverActive ? 2 : 1);
}

// extraScale: ランクの基準点にかける倍率（ふたりモードは点が出やすいので、基準を上げる）
export function rankForScore(score, seconds, difficulty, extraScale = 1) {
  const difficultyScale = { easy: 0.8, normal: 1, hard: 1.25, extreme: 1.6 }[difficulty] || 1;
  const scale = (seconds / 60) * difficultyScale * extraScale;
  if (score >= 3600 * scale) return 'S';
  if (score >= 2200 * scale) return 'A';
  if (score >= 1100 * scale) return 'B';
  if (score >= 450 * scale) return 'C';
  return 'D';
}
