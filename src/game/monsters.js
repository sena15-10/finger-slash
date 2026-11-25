import { TUNING } from '../config.js';

const MON = {
  slime: { name: 'スライム', r: 34, hp: 1, pts: 10,  color: '#5dff9a', desc: '10点', spr: 2.6 },
  ghost: { name: 'ゴースト', r: 32, hp: 1, pts: 20,  color: '#bfe3ff', desc: '20点・よこにうごく', spr: 2.6 },
  bat:   { name: 'コウモリ', r: 25, hr: 34, hp: 1, pts: 30, color: '#b07cff', desc: '30点・すばやい', spr: 3.4 },
  golem: { name: 'ゴーレム', r: 52, hp: 3, pts: 100, color: '#c3cbd9', desc: '100点・3回あてる', spr: 2.4 },
  star:  { name: 'ほし',     r: 30, hp: 1, pts: 50,  color: '#ffc83d', desc: 'とると得点2倍', fever: true, spr: 2.6 },
  bomb:  { name: 'ばくだん', r: 30, hp: 1, pts: 0,   color: '#ff4d5e', desc: `さわると −${TUNING.bombPenaltySeconds}びょう`, bad: true, spr: 2.6 },
};

export { MON };
