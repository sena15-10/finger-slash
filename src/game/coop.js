// ふたりで きょうりょく: 2人の手の選び方と、合体技を出すかどうかの判定（画面や音に関係しない部分）
import { gestureReady } from '../input/gesture.js';

// 画面の左半分と右半分から、いちばん大きく写っている手を1つずつえらぶ。
// （1人が両手を出していても、となりの人の手がちゃんと使われるように）
// 片方に手がないときは、もう片方の2番目に大きい手も使う（1人で2つの手を使ってもよい）
// hands: { pts（21点。0番 = 手首）, size } のならび
export function pickCoopHands(hands, width) {
  const bySize = [...hands].sort((a, b) => b.size - a.size);
  const left = bySize.find(h => h.pts[0].x < width / 2);
  const right = bySize.find(h => h.pts[0].x >= width / 2);
  const out = [left, right].filter(Boolean);
  for (const h of bySize) { if (out.length >= 2) break; if (!out.includes(h)) out.push(h); }
  return out;
}

// 必殺技を出すかどうか決める。trackers は手ごとの createGestureTracker()
// ・ふたりモードで、2つの手が同じ形のまま止まっていたら「合体技」
// ・1つの手だけのときは、ふたりモードでは あいぼうが同じ形をするのを waitSeconds だけ待ってから、ふつうの技
// 出さないときは null。出すときは { kind, merged, trackers }（trackers[0] が技を出す手）
export function decideSpecial(trackers, cfg, { coop = false, waitSeconds = 0 } = {}) {
  const ready = trackers.filter(tr => gestureReady(tr, cfg));
  if (!ready.length) return null;
  if (coop) {
    for (let i = 0; i < ready.length; i++) {
      const partner = ready.find((tr, j) => j > i && tr.kind === ready[i].kind);
      if (partner) return { kind: ready[i].kind, merged: true, trackers: [ready[i], partner] };
    }
  }
  const wait = coop ? waitSeconds : 0;
  const solo = ready.find(tr => tr.hold >= cfg.holdSeconds + wait);
  return solo ? { kind: solo.kind, merged: false, trackers: [solo] } : null;
}
