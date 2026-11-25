// ボスのセリフと、けっか画面の実況コメントを選ぶ（中身の文章は lines.js にある）

// ボスのセリフの場面
export const BOSS_SCENES = ['appear', 'zigzag', 'rush', 'telegraph', 'hurt', 'fist', 'defeated', 'escaped'];
// けっか画面の実況コメントの種類（rank_* はランク、ほかはそのプレイで起きたこと）
export const RESULT_KINDS = ['rank_S', 'rank_A', 'rank_B', 'rank_C', 'rank_D', 'bossDefeated', 'bossEscaped', 'fist', 'shield', 'reflectMany', 'ghostWin'];
// これ以上はじき返したら「reflectMany」
export const REFLECT_MANY = 5;
// 起きたことのコメントを、ランクのコメントより優先する割合
export const SPECIAL_CHANCE = 0.6;

const pickFrom = (list, rand) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

// その場面のセリフを1つ選ぶ。セリフが無ければ ''
export function pickBossLine(lines, scene, rand = Math.random) {
  const list = lines && lines[scene];
  return Array.isArray(list) && list.length ? pickFrom(list, rand) : '';
}

// stats: { rank, bossDefeated, bossEscaped, fistUses, shieldUses, reflects, ghostWin }
export function resultCommentKinds(stats) {
  const kinds = [];
  if (stats.bossDefeated) kinds.push('bossDefeated');
  if (stats.bossEscaped) kinds.push('bossEscaped');
  if (stats.fistUses > 0) kinds.push('fist');
  if (stats.shieldUses > 0) kinds.push('shield');
  if (stats.reflects >= REFLECT_MANY) kinds.push('reflectMany');
  if (stats.ghostWin) kinds.push('ghostWin');
  return kinds;
}

// 起きたことがあれば SPECIAL_CHANCE の割合でそちらを、そうでなければランクのコメントを選ぶ
export function pickResultComment(comments, stats, rand = Math.random) {
  if (!comments) return '';
  const specials = resultCommentKinds(stats).filter(k => Array.isArray(comments[k]) && comments[k].length);
  const rankKey = 'rank_' + stats.rank;
  const rankList = Array.isArray(comments[rankKey]) ? comments[rankKey] : [];
  if (specials.length && (!rankList.length || rand() < SPECIAL_CHANCE)) return pickFrom(comments[pickFrom(specials, rand)], rand);
  return rankList.length ? pickFrom(rankList, rand) : '';
}
