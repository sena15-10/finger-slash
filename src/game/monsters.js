import { TUNING } from '../config.js';

// r: 大きさ（半径）, hr: 当たりの半径（ないときは r）, hp: たおすまでに必要な回数, pts: 点数, spr: 画像にしたときの大きさ
// note: ずかんの説明にそえることば。desc があるものは、その説明をそのまま使う
// speed: 速さの倍率, freq: 出やすさの倍率（どちらもメニューの「モンスター改造」で変わる。ふつうは1）
const MON = {
  slime: { name: 'スライム', r: 34, hp: 1, pts: 10,  color: '#5dff9a', spr: 2.6 },
  ghost: { name: 'ゴースト', r: 32, hp: 1, pts: 20,  color: '#bfe3ff', note: 'よこにうごく', spr: 2.6 },
  bat:   { name: 'コウモリ', r: 25, hr: 34, hp: 1, pts: 30, color: '#b07cff', note: 'すばやい', spr: 3.4 },
  golem: { name: 'ゴーレム', r: 52, hp: 3, pts: 100, color: '#c3cbd9', spr: 2.4 },
  star:  { name: 'ほし',     r: 30, hp: 1, pts: 50,  color: '#ffc83d', desc: 'とると得点2倍', fever: true, spr: 2.6 },
  bomb:  { name: 'ばくだん', r: 30, hp: 1, pts: 0,   color: '#ff4d5e', desc: `さわると −${TUNING.bombPenaltySeconds}びょう`, bad: true, spr: 2.6 },
};
for (const T of Object.values(MON)) { T.speed = 1; T.freq = 1; }

// 改造する前の、元のデータ（「元にもどす」で使う）
const MON_BASE = JSON.parse(JSON.stringify(MON));

// ずかんの説明（例: 「100点・3回あてる」）。改造した点数や体力に合わせて変わる
function describe(T) {
  if (T.desc) return T.desc;
  return [`${T.pts}点`, T.hp > 1 ? `${T.hp}回あてる` : '', T.note || ''].filter(Boolean).join('・');
}

export { MON, MON_BASE, describe };
