// 指先(tip)・第2関節(PIP)・手首(0)。親指は見ない。人さし指・中指・薬指・小指のみ
const FINGER_JOINTS = [[8, 6], [12, 10], [16, 14], [20, 18]];

// points は、画面の幅・高さを掛けた座標（21点、MediaPipeの番号）
export function countBentFingers(points) {
  const wrist = points[0];
  let bent = 0;
  for (const [tip, pip] of FINGER_JOINTS) {
    const dTip = Math.hypot(points[tip].x - wrist.x, points[tip].y - wrist.y);
    const dPip = Math.hypot(points[pip].x - wrist.x, points[pip].y - wrist.y);
    if (dTip < dPip) bent++;
  }
  return bent;
}

export function classifyHandShape(points, tuning) {
  const bent = countBentFingers(points);
  if (bent >= tuning.fistFingers) return 'fist';
  if (bent === 0) return 'open';
  return 'none';
}

export function createHoldTracker() {
  return { held: 0, bad: 0 };
}

// 形が崩れても graceMs 以内に戻れば、保持時間はリセットされない（途切れている間は増えない）
export function updateHold(tracker, isTarget, dt, graceMs) {
  if (isTarget) {
    tracker.held += dt;
    tracker.bad = 0;
  } else {
    tracker.bad += dt;
    if (tracker.bad * 1000 > graceMs) tracker.held = 0;
  }
  return tracker.held;
}

export function createGestureState() {
  return {
    gauge: 0,
    fist: createHoldTracker(),
    open: createHoldTracker(),
    shieldActive: false,
    shieldTimeLeft: 0,
    shieldCooldownLeft: 0,
    shieldX: 0,
    shieldY: 0,
  };
}

export function addGauge(state, amount) {
  state.gauge = Math.min(100, state.gauge + amount);
}

// ゲージが100%で、グーの形が fistHold びょう続いたら発動。発動後、ゲージと保持時間は0に戻る
export function consumeFist(state, tuning) {
  if (state.gauge < 100 || state.fist.held < tuning.fistHold) return false;
  state.gauge = 0;
  state.fist.held = 0;
  return true;
}

// パーの形が openHold びょう続き、クールダウン中でなければ発動
export function tryActivateShield(state, tuning) {
  if (state.shieldCooldownLeft > 0 || state.open.held < tuning.openHold) return false;
  state.shieldActive = true;
  state.shieldTimeLeft = tuning.shieldDuration;
  state.shieldCooldownLeft = tuning.shieldCooldown;
  state.open.held = 0;
  return true;
}

export function updateShieldTimers(state, dt) {
  if (state.shieldCooldownLeft > 0) state.shieldCooldownLeft = Math.max(0, state.shieldCooldownLeft - dt);
  if (state.shieldActive) {
    state.shieldTimeLeft -= dt;
    if (state.shieldTimeLeft <= 0) { state.shieldActive = false; state.shieldTimeLeft = 0; }
  }
}

export function shotInsideShield(shotX, shotY, state, radius) {
  if (!state.shieldActive) return false;
  return Math.hypot(shotX - state.shieldX, shotY - state.shieldY) <= radius;
}
