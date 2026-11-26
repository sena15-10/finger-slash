// 手の形（ジェスチャー）を、AIが見つけた手の21点から見分ける。
// 指が「のびている」か「まがっている」かは、手首から指先までの長さと、手首から第2関節までの長さをくらべて決める
// （手の大きさや、カメラからの近さが変わっても同じように判定できる）
const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]];   // [指先, 第2関節] … 人さし指・中指・くすり指・小指
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const GESTURE_NAMES = { open: 'パー', peace: 'ピース', fist: 'グー' };

// 1 = のびている, 0 = まがっている, -1 = どちらとも言えない
export function fingerStates(pts, extended = 1.12, folded = 0.98) {
  const wrist = pts[0];
  return FINGERS.map(([tip, pip]) => {
    const ratio = dist(wrist, pts[tip]) / Math.max(1e-6, dist(wrist, pts[pip]));
    return ratio > extended ? 1 : ratio < folded ? 0 : -1;
  });
}

// 'open'（パー）/ 'peace'（ピース）/ 'fist'（グー）/ null（それ以外。人さし指だけのばしている など）
export function classifyHand(pts) {
  if (!pts || pts.length < 21) return null;
  const [index, middle, ring, pinky] = fingerStates(pts);
  if (index === 1 && middle === 1 && ring === 1 && pinky === 1) return 'open';
  if (index === 1 && middle === 1 && ring === 0 && pinky === 0) return 'peace';
  if (index === 0 && middle === 0 && ring === 0 && pinky === 0) return 'fist';
  return null;
}

// 同じ形のまま、手をほぼ止めて holdSeconds たったら「発動OK」。
// 斬るときに手のひらを開いたまま動かしても、動いている間は発動しない
export function createGestureTracker() {
  return { kind: null, hold: 0, x: 0, y: 0, lastT: null, locked: false };
}

export function updateGesture(tracker, hands, t, cfg) {
  const dt = tracker.lastT === null ? 0 : Math.min(0.2, Math.max(0, t - tracker.lastT));
  tracker.lastT = t;
  let found = null;
  for (const pts of hands) { const kind = classifyHand(pts); if (kind) { found = { kind, c: pts[9] }; break; } }   // 9 = 中指のつけね（手のひらの中心）
  if (!found) { tracker.kind = null; tracker.hold = 0; tracker.locked = false; return tracker; }
  const same = found.kind === tracker.kind;
  const speed = same && dt > 0 ? Math.hypot(found.c.x - tracker.x, found.c.y - tracker.y) / dt : 0;
  if (!same) tracker.locked = false;   // 形を変えたら、もう一度発動できる
  tracker.hold = same && speed <= cfg.maxSpeed ? tracker.hold + dt : 0;
  tracker.kind = found.kind; tracker.x = found.c.x; tracker.y = found.c.y;
  return tracker;
}

export const gestureReady = (tracker, cfg) => !!tracker.kind && !tracker.locked && tracker.hold >= cfg.holdSeconds;

// 発動したら、手の形を変えるまで同じ技は出ない
export function consumeGesture(tracker) {
  tracker.hold = 0;
  tracker.locked = true;
}
