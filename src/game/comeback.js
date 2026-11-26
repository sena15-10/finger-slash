// 逆転ゲージ: ばくだんや火の玉に当たるたびにたまり、満タンになると「逆転タイム」が始まる。
// ミスが多い人ほどチャンスが来るので、ピンチからでも追いつける
export function comebackEnabled(cfg, difficulty) {
  return !!cfg && Array.isArray(cfg.difficulties) && cfg.difficulties.includes(difficulty);
}

export function createComeback() {
  return { gauge: 0, t: 0 };
}

// ダメージを1回受けたとき。逆転タイムが始まったら true を返す
export function addComebackDamage(state, cfg) {
  if (state.t > 0) return false;   // 逆転タイム中は、ゲージをためない
  state.gauge = Math.min(cfg.gaugeMax, state.gauge + 1);
  if (state.gauge < cfg.gaugeMax) return false;
  state.gauge = 0;
  state.t = cfg.seconds;
  return true;
}

export function tickComeback(state, dt) {
  if (state.t > 0) state.t = Math.max(0, state.t - dt);
}

export const comebackActive = state => !!state && state.t > 0;
