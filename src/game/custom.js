// モンスター改造: メニューの「モンスター改造」で変えた数字を、モンスターのデータ（MON）とボスの設定にあてはめる。
// 画面や保存には関係しない部分なので、テストでそのまま確かめられる

// 変えられる数字と、+ / − ボタンで選べる値
export const CUSTOM_FIELDS = {
  hp:    { label: '体力',     sub: 'あてる回数',     values: [1, 2, 3, 4, 5, 6, 8, 10, 15, 20] },
  pts:   { label: '点数',     sub: 'たおしたときの点', values: [0, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000] },
  size:  { label: '大きさ',   sub: '％',             values: [50, 70, 85, 100, 120, 150, 200] },
  speed: { label: '速さ',     sub: '％',             values: [50, 70, 85, 100, 120, 150, 200] },
  freq:  { label: '出やすさ', sub: '％（0で出ない）', values: [0, 25, 50, 100, 150, 200, 300] },
};
// ボスだけは、体力と点数（たおしたときのボーナス）の値の大きさがちがう
const BOSS_VALUES = { hp: [50, 100, 150, 200, 300, 500, 800, 1000], pts: [0, 100, 300, 500, 1000, 2000, 5000] };

// 画面にならべる順番と、それぞれ変えられる数字（ばくだんは体力・点数なし、ボスは大きさ・出やすさなし）
export const CUSTOM_ROWS = [
  { type: 'slime', fields: ['hp', 'pts', 'size', 'speed', 'freq'] },
  { type: 'ghost', fields: ['hp', 'pts', 'size', 'speed', 'freq'] },
  { type: 'bat',   fields: ['hp', 'pts', 'size', 'speed', 'freq'] },
  { type: 'golem', fields: ['hp', 'pts', 'size', 'speed', 'freq'] },
  { type: 'star',  fields: ['hp', 'pts', 'size', 'speed', 'freq'] },
  { type: 'bomb',  fields: ['size', 'speed', 'freq'] },
  { type: 'boss',  fields: ['hp', 'pts', 'speed'] },
];

export const valuesFor = (type, field) => (type === 'boss' && BOSS_VALUES[field]) || CUSTOM_FIELDS[field].values;

// 改造していないときの数字（monBase: 元のモンスターのデータ, bossBase: 元のボスの設定）
export function defaultCustom(monBase, bossBase) {
  const out = {};
  for (const { type, fields } of CUSTOM_ROWS) {
    out[type] = {};
    for (const f of fields) {
      if (type === 'boss') out[type][f] = f === 'hp' ? bossBase.hp : f === 'pts' ? bossBase.bonus : 100;
      else out[type][f] = f === 'hp' || f === 'pts' ? monBase[type][f] : 100;
    }
  }
  return out;
}

// 保存してあった数字を読みこむ。こわれた値や、はんいの外の値は直す
export function sanitizeCustom(raw, defaults) {
  const out = {};
  for (const [type, def] of Object.entries(defaults)) {
    out[type] = {};
    for (const [f, d] of Object.entries(def)) {
      const list = valuesFor(type, f), rv = raw && raw[type] ? raw[type][f] : undefined;
      const v = rv === null || rv === undefined || rv === '' ? NaN : Number(rv);   // Number(null) は 0 になるので、先に分ける
      const lo = Math.min(list[0], d), hi = Math.max(list[list.length - 1], d);
      out[type][f] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;
    }
  }
  return out;
}

// + / − ボタン: となりの値へ（もう先がなければ そのまま）
export function stepCustom(type, field, value, dir) {
  const list = valuesFor(type, field);
  if (dir > 0) { const v = list.find(x => x > value); return v === undefined ? value : v; }
  const v = [...list].reverse().find(x => x < value); return v === undefined ? value : v;
}

export function isCustomized(cfg, defaults) {
  return Object.entries(defaults).some(([type, def]) => Object.entries(def).some(([f, d]) => cfg[type][f] !== d));
}

// 改造した数字を、モンスターのデータとボスの設定に書きこむ（元のデータ monBase / bossBase は変えない）
export function applyCustom(cfg, mon, monBase, boss, bossBase) {
  for (const type of Object.keys(monBase)) {
    const base = monBase[type], c = cfg[type] || {}, k = (c.size ?? 100) / 100;
    const m = mon[type];
    m.hp = c.hp ?? base.hp; m.pts = c.pts ?? base.pts;
    m.r = Math.round(base.r * k); if (base.hr) m.hr = Math.round(base.hr * k);
    m.speed = (c.speed ?? 100) / 100; m.freq = (c.freq ?? 100) / 100;
  }
  if (cfg.boss) {
    boss.hp = cfg.boss.hp; boss.bonus = cfg.boss.pts;
    boss.moveSpeed = Math.round(bossBase.moveSpeed * cfg.boss.speed / 100);
    boss.dashSpeed = Math.round(bossBase.dashSpeed * cfg.boss.speed / 100);
  }
}
