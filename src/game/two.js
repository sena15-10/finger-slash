// 2人同時プレイ（左右に1人ずつ）のための、画面やAIに関係しない計算
// 0 = 左の人（ptrs[0]）、1 = 右の人（ptrs[1]）

// 手首(0)と手のひら中心(9)の距離 = 写っている手の大きさ（画面ピクセル）
export function handSize(pts) {
  return Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y);
}

// 火の玉が届いた位置など、画面のx座標がどちらの人の側か
export function playerIndexForX(x, width, two) {
  return two && x >= width / 2 ? 1 : 0;
}

// ボスへの斬りのクールダウンを数える単位（＝人）。1人プレイは両手で1つ、2人プレイは左右の人で別々
// ptrIndex: ptrs の何番目の指か（0 / 1）
export function slashCooldownKey(ptrIndex, two) {
  return two && ptrIndex === 1 ? 'p2' : 'p1';
}

// AIが見つけた手から、左右それぞれ1つずつ選ぶ。戻り値は [左の手 or null, 右の手 or null]
//  1) 小さすぎる手（うしろに並んでいる人の手）は使わない
//  2) 手のひら中心が、画面の真ん中の不感帯（幅 × centerDeadZone の半分ずつ）に入っている手は使わない
//  3) 各側で、いちばん大きく写っている手（＝前に立っている人の手）を1つだけ使う
// hands: { pts: 21点（画面ピクセル）, size?: 大きさ } の配列
export function selectTwoPlayerHands(hands, { width, minPx = 0, centerDeadZone = 0 }) {
  const mid = width / 2, dead = width * centerDeadZone / 2;
  const best = [null, null];
  for (const h of hands) {
    const size = h.size ?? handSize(h.pts);
    if (size < minPx) continue;
    const x = h.pts[9].x;
    if (Math.abs(x - mid) < dead) continue;
    const side = x < mid ? 0 : 1;
    if (!best[side] || size > (best[side].size ?? handSize(best[side].pts))) best[side] = h;
  }
  return best;
}

// 結果画面: 'l'（左の勝ち）/ 'r'（右の勝ち）/ 'draw'（ひきわけ）
export function twoPlayerVerdict(l, r) {
  return l > r ? 'l' : r > l ? 'r' : 'draw';
}

// ボスへのダメージの結果、撃破ボーナスがあれば、そのダメージを与えた人（pi）に入れる
// addScore(pi, 点) を呼ぶ。入れた点数を返す
export function creditBossResult(result, pi, addScore) {
  if (!result || !result.defeated || !result.bonus) return 0;
  addScore(pi, result.bonus);
  return result.bonus;
}

// ---- 2人用ランキング（1人用とは別のキーに保存）。1件 = { total, l, r, ts } ----
export function makeTwoEntry(l, r, ts) {
  return { total: l + r, l, r, ts };
}

export function validTwoEntries(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(e => e && typeof e.total === 'number' && typeof e.l === 'number' && typeof e.r === 'number' && typeof e.ts === 'number');
}

// 今日の記録はぜんぶ、ほかの日はベスト50だけ残す（1人用の saveScores と同じ考え方）
export function pruneTwoScores(list, todayKey, dayKey) {
  const valid = validTwoEntries(list);
  const td = valid.filter(e => dayKey(e.ts) === todayKey).slice(-2950);
  const old = valid.filter(e => dayKey(e.ts) !== todayKey).sort((a, b) => b.total - a.total).slice(0, 50);
  return td.concat(old);
}

// 「今日の記録をリセット」: 今日の分だけ消し、ほかの日のベストは残す
export function removeTodayTwoScores(list, todayKey, dayKey) {
  return validTwoEntries(list).filter(e => dayKey(e.ts) !== todayKey);
}

// ランキング表示用（既存の表示を流用するため { n, s, at } の形にする）
export function twoBoardRows(list) {
  return list.map(e => ({ n: `左${e.l}／右${e.r}`, s: e.total, at: e.ts }));
}
