import { TUNING, CALLS, TIPS, MP_VERSION, CDN, MODEL_URLS } from '../config.js';
import { MON, MON_BASE, describe } from './monsters.js';
import { CUSTOM_FIELDS, CUSTOM_ROWS, applyCustom, defaultCustom, isCustomized, sanitizeCustom, stepCustom } from './custom.js';
import { comboMultiplier, rankForScore } from './scoring.js';
import { createEffects } from '../render/effects.js';
import { createAudio } from '../audio/audio.js';
import { createCamera } from '../input/camera.js';
import { createMotion } from '../input/motion.js';
import { createAttacks } from './attacks.js';
import { createBoss, damageBoss, punchBoss, shouldSpawnBoss, updateBoss } from './boss.js';
import { GESTURE_NAMES, classifyHand, consumeGesture, createGestureTracker, updateGesture } from '../input/gesture.js';
import { createGhostSample, ghostResultText, packGhost, sampleGhost, unpackGhost } from './ghost.js';
import { addComebackDamage, comebackActive, comebackEnabled, createComeback, tickComeback } from './comeback.js';
import { decideSpecial, pickCoopHands } from './coop.js';


// ============================================================
//  FINGER SLASH — カメラ × AI で遊ぶアクションゲーム
//
//  ・手の認識: Google MediaPipe「Hand Landmarker」（ブラウザの中で動くAI）
//  ・AIが使えない時の代わり: 「モーション」（前の映像とのちがいを見るだけ）
//  ・カメラが使えない時の代わり: 「マウス / タッチ」
//  ・画像に差しかえたいとき: assets フォルダに、
//      slime.png ghost.png bat.png golem.png star.png bomb.png boss.png（背景が透明なPNG）を入れる
//
//  ★ 改造したい人へ: src/config.js の TUNING の数字を変えると、ゲームの感じが変わります。
// ============================================================
const W = 960, H = 540, TAU = Math.PI * 2;
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const pick = a => a[(Math.random() * a.length) | 0];
const easeOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const FX = '"Bungee","Dela Gothic One",sans-serif';
const FB = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","Yu Gothic UI",Meiryo,sans-serif';
const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const embedded = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();

const memStore = {};   // localStorage が使えないブラウザ用（ページを開いている間だけ覚える）
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('fingerSlash.' + k); return v === null ? d : JSON.parse(v); }
    catch (e) { return k in memStore ? JSON.parse(memStore[k]) : d; }
  },
  set(k, v) { try { localStorage.setItem('fingerSlash.' + k, JSON.stringify(v)); } catch (e) { memStore[k] = JSON.stringify(v); } },
};
const qs = new URLSearchParams(location.search);
const oneOf = (v, list, d) => list.includes(v) ? v : d;
const DIFFS = ['easy', 'normal', 'hard', 'extreme'];
const S = {
  mode: oneOf(qs.get('mode'), ['ai', 'motion', 'mouse'], oneOf(store.get('mode', 'ai'), ['ai', 'motion', 'mouse'], 'ai')),
  diff: oneOf(qs.get('diff'), DIFFS, oneOf(store.get('diff', 'normal'), DIFFS, 'normal')),
  time: clamp(parseInt(qs.get('time') || store.get('time', TUNING.roundSeconds), 10) || TUNING.roundSeconds, 10, 180),
  sound: qs.get('mute') === '1' ? false : !!store.get('sound', true),
  eye: qs.get('eye') === '1',
  booth: qs.has('booth') ? qs.get('booth') !== '0' : store.get('booth', true) !== false,
  view: oneOf(qs.get('view'), ['show', 'blur', 'hide'], oneOf(store.get('view', 'show'), ['show', 'blur', 'hide'], 'show')),
  attack: qs.has('attack') ? qs.get('attack') !== '0' : store.get('attack', true) !== false,
  boss: qs.has('boss') ? qs.get('boss') !== '0' : store.get('boss', true) !== false,
  ghost: qs.has('ghost') ? qs.get('ghost') !== '0' : store.get('ghostEnabled', true) !== false,
  coop: qs.has('coop') ? qs.get('coop') === '1' : store.get('coop', false) === true,   // ふたりで きょうりょく
};
const diffCfg = () => TUNING.difficulty[S.diff];

// ---- モンスター改造（メニューの「モンスター改造」で変えた数字。この端末に保存）----
const BOSS_BASE = { ...TUNING.boss };   // 改造する前の、元のボスの設定
const MON_DEFAULTS = defaultCustom(MON_BASE, BOSS_BASE);
let monCfg = sanitizeCustom(store.get('monsters', null), MON_DEFAULTS), customOn = false;
function applyMonCfg() { applyCustom(monCfg, MON, MON_BASE, TUNING.boss, BOSS_BASE); customOn = isCustomized(monCfg, MON_DEFAULTS); }
applyMonCfg();
// TIPS の {golem.hp} などを、いまの数字に置きかえる
const tipText = () => pick(TIPS).replace(/\{(\w+)\.(\w+)\}/g, (_, type, key) => MON[type] ? String(MON[type][key]) : '');

// ---- 画像（assets フォルダにあれば、絵のかわりに使う）----
const SPR = {};
if (qs.get('assets') !== '0') {
  const assetUrls = import.meta.glob('../../assets/*.png', { eager: true, query: '?url', import: 'default' });
  for (const [path, url] of Object.entries(assetUrls)) {
    const name = path.split('/').pop().replace(/\.png$/i, '');
    const image = new Image();
    image.onload = () => { SPR[name] = image; drawDexIcons(); };
    image.src = url;
  }
}

// ============================================================
//  画面（960×540 で作って、まるごと拡大縮小する）
// ============================================================
const stage = $('#stage'), cv = $('#game');
let ctx = cv.getContext('2d', { alpha: false });
let scale = 1;
function resize() {
  const k = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.transform = `translate(-50%,-50%) scale(${k})`;
  const bs = Math.min(k * Math.min(window.devicePixelRatio || 1, 2), 2.2);
  cv.width = Math.round(W * bs); cv.height = Math.round(H * bs); scale = cv.width / W;
}
window.addEventListener('resize', resize); resize();
try { document.fonts.load('400 20px "Bungee"'); document.fonts.load('400 20px "Dela Gothic One"'); document.fonts.load('800 20px "M PLUS Rounded 1c"'); } catch (e) { /* フォントなしでも動く */ }

// 背景（夜空のグラデーション）と周辺をくらくする幕を、先に1枚ずつ描いておく
const mkLayer = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
const skyLayer = mkLayer(), vigLayer = mkLayer();
const HZ = 300, STARS = Array.from({ length: 70 }, () => ({ x: rnd(0, W), y: rnd(0, HZ - 20), s: rnd(.6, 1.8), p: rnd(0, TAU) }));
(() => {
  const c = skyLayer.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#070b2e'); g.addColorStop(.55, '#120c3a'); g.addColorStop(1, '#04050f');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const rg = c.createRadialGradient(W / 2, HZ, 10, W / 2, HZ, 460); rg.addColorStop(0, 'rgba(255,46,136,.38)'); rg.addColorStop(.5, 'rgba(139,92,255,.14)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = rg; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,46,136,.55)'; c.fillRect(0, HZ - 1, W, 2);
  const v = vigLayer.getContext('2d'); const vg = v.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .95);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)'); v.fillStyle = vg; v.fillRect(0, 0, W, H);
})();
function rrPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function txt(s, x, y, size, color, align = 'left', weight = 700, font = FB, stroke) {
  ctx.font = `${weight} ${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if (stroke) { ctx.lineWidth = stroke.w; ctx.strokeStyle = stroke.c; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}

// ============================================================
//  音（WebAudioで作るので、音ファイルは不要）
const Cam = createCamera({
  video: $('#cam'),
  width: W,
  height: H,
  onDisconnect: () => toast('カメラの接続が切れました。カメラをつなぎ直してから、S キーでメニューにもどり「GAME START」をおしてください', 12000),
});
function mapNorm(nx, ny) { const c = Cam.cv; return { x: c.ox + (1 - nx) * c.dw, y: c.oy + ny * c.dh }; }
function camMessage(e) {
  const n = e && e.name;
  if (n === 'NoMediaDevices') return 'このページではカメラを使えません（https:// で開く必要があります）。今回はマウスで遊びます。';
  if (n === 'NotAllowedError' || n === 'SecurityError') return embedded
    ? 'いまの表示枠（プレビュー）ではカメラが使えません。Webに公開したURLを新しいタブで開くと、カメラで遊べます。今回はマウスで遊びます。'
    : 'カメラが許可されていません。アドレスバーのカメラマークから許可してね。今回はマウスで遊びます。';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'カメラが見つかりません。今回はマウスで遊びます。';
  if (n === 'NotReadableError' || n === 'AbortError') return 'ほかのアプリがカメラを使っているかも。今回はマウスで遊びます。';
  return 'カメラを開始できませんでした。今回はマウスで遊びます。';
}

// ============================================================
//  モーション検出（AIなし。前のフレームとの“ちがい”を見るだけ）
// ============================================================
const Motion = createMotion({ width: W, height: H, lerp, getContext: () => ctx });

const HAND_LINKS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + label)), ms))]);
const AI = {
  lm: null, p: null, hands: [], prev: [], valid: 0, lastVT: -1, errs: 0, ms: 0, info: '', slowShown: false, lastErr: null,
  ensure() {
    if (this.lm) return Promise.resolve(this.lm);
    if (!this.p) this.p = loadLandmarker().then(lm => { this.lm = lm; return lm; }, e => { this.p = null; this.lastErr = e; throw e; });
    return this.p;
  },
};
const EXPECT_MB = 22;   // 進み具合の目安（wasm 約15MB + モデル 約8MB）
let dlBytes = 0;
function onBytes(n) {
  dlBytes += n; if (state !== 'loading') return;
  const mb = dlBytes / 1048576; $('#loadBar').style.width = Math.min(96, mb / EXPECT_MB * 100) + '%';
  $('#loadSub').textContent = `AIのデータをダウンロード中… ${mb.toFixed(1)} / 約${EXPECT_MB} MB（はじめだけです。次からは早くなります）`;
}
// ファイルをダウンロードしながら、進み具合を知らせる（keep=false なら、キャッシュに入れるだけで捨てる）
async function fetchBytes(url, timeout, keep) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal }); if (!res.ok) throw new Error('http ' + res.status);
    if (!res.body || !res.body.getReader) { const b = new Uint8Array(await res.arrayBuffer()); onBytes(b.length); return keep ? b : null; }
    const rd = res.body.getReader(), parts = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; onBytes(value.length); if (keep) parts.push(value); }
    if (!keep) return null;
    const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
  } finally { clearTimeout(to); }
}
async function loadLandmarker() {
  const kits = [];
  if (window.FINGER_SLASH_KIT) kits.push(window.FINGER_SLASH_KIT);   // 学校のサーバー等に自前で置く場合の差し替え口
  kits.push({ name: 'local', bundle: '/vendor/vision_bundle.mjs', wasm: '/vendor/wasm', models: ['/vendor/hand_landmarker.task'], timeout: 15000 });
  kits.push({ name: 'cdn', bundle: `${CDN}/vision_bundle.mjs`, wasm: `${CDN}/wasm`, models: MODEL_URLS, timeout: 120000 });
  let lastErr = null; dlBytes = 0;
  for (const kit of kits) {
    try {
      const mod = await withTimeout(import(kit.bundle), kit.timeout, 'bundle');
      let model = null;   // 先に小さいモデルを取る（取れなければ、大きいwasmを無駄に落とさない）
      for (const url of kit.models) { try { model = await fetchBytes(url, kit.timeout, true); break; } catch (e) { lastErr = e; } }
      if (!model) continue;
      for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) { try { await fetchBytes(kit.wasm + '/' + f, kit.timeout, false); } catch (e) { /* 本番の読みこみでもう一度ためす */ } }
      const fileset = await withTimeout(mod.FilesetResolver.forVisionTasks(kit.wasm), kit.timeout, 'wasm');
      // GPU と CPU の両方で実際に速さを測り、速いほうを使う
      // （GPUが使えないPCでは、GPU方式がソフトで代わりに動いて10倍以上おそくなることがあるため）
      const pref = (qs.get('delegate') || '').toUpperCase(), order = pref === 'CPU' ? ['CPU'] : pref === 'GPU' ? ['GPU'] : ['GPU', 'CPU'];
      let best = null, bestMs = Infinity, bestD = '';
      for (const delegate of order) {
        let lm;
        try {
          lm = await withTimeout(mod.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetBuffer: model.slice(), delegate }, runningMode: 'VIDEO', numHands: 3,
            minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
          }), kit.timeout, 'init');
        } catch (e) { lastErr = e; continue; }
        if (state === 'loading') $('#loadSub').textContent = `AIの速さを測っています…（${delegate}）`;
        const ms = await benchLandmarker(lm);
        if (ms < bestMs) { if (best) try { best.close(); } catch (e) { /* 何もしない */ } best = lm; bestMs = ms; bestD = delegate; }
        else try { lm.close(); } catch (e) { /* 何もしない */ }
        if (bestMs <= 25) break;   // じゅうぶん速ければ、もう一方は試さない
      }
      if (best) { AI.info = `${kit.name}/${bestD}`; AI.ms = isFinite(bestMs) ? bestMs : 0; return best; }
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('AI load failed');
}
// 何回か手の検出を動かして、1回あたりの時間（ミリ秒）を測る。最初の2回は準備運動なので数えない
async function benchLandmarker(lm) {
  const v = Cam.video; if (!Cam.ready || v.readyState < 2) return 0;
  const times = [];
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 20));
    const a = performance.now(); try { lm.detectForVideo(v, a); } catch (e) { return Infinity; }
    if (i >= 2) times.push(performance.now() - a);
    if (i === 2 && times[0] > 250) break;   // 明らかにおそいときは、それ以上測らない
  }
  times.sort((x, y) => x - y); return times[Math.floor(times.length / 2)];
}
function aiStep(t, dt) {
  if (!AI.lm || !Cam.ready) return;
  // AIが重いPCでは、何コマかに1回だけ検出して、画面の動きをなめらかに保つ
  const every = AI.ms > 45 ? 3 : AI.ms > 22 ? 2 : 1;
  if (frameCount % every !== 0) return;
  const v = Cam.video; if (v.readyState < 2 || v.currentTime === AI.lastVT) return; AI.lastVT = v.currentTime;
  const t0 = performance.now(); let res;
  try { res = AI.lm.detectForVideo(v, t0); AI.errs = 0; }
  catch (e) { if (++AI.errs > 8) { toast('AIがうまく動かないので、モーションモードに切りかえます', 6000); AI.lm = null; AI.p = null; switchToMotion(); } return; }
  AI.ms = lerp(AI.ms, performance.now() - t0, .1);
  if (!AI.slowShown && AI.ms > 60 && frameCount > 120) { AI.slowShown = true; toast('動きがカクカクするときは、「モーション」モードがおすすめです', 6000); }
  // 極端に重い（1回0.15びょう以上）状態が3びょう続いたら、ゲームが止まらないようにモーションへ
  AI.slowT = AI.ms > 150 ? (AI.slowT || 0) + Math.max(dt, AI.ms / 1000) : 0;
  if (AI.slowT > 3) { AI.slowT = 0; toast('このPCではAIの処理が重すぎるので、モーションモードに切りかえました。STAFFメニューから変更できます', 9000); switchToMotion(); return; }
  // 大きく写っている手（＝前に立っている人の手）から順に2つまで使う。ふたりモードでは、画面の左右から1つずつ
  const all = (res && res.landmarks) ? res.landmarks : [], minPx = S.booth ? TUNING.boothMinHandPx : 0;
  AI.hands = all.map(h => { const pts = h.map(l => mapNorm(l.x, l.y)); return { lm: h, pts, raw: pts, size: Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y), ok: false }; });
  predictHands(t, dt * every);
  const near = AI.hands.filter(h => h.size >= minPx);
  const valid = S.coop ? pickCoopHands(near, W) : near.sort((a, b) => b.size - a.size).slice(0, 2);
  for (const h of valid) h.ok = true;
  AI.valid = valid.length;
  const owner = assignHands(valid.map(h => h.pts), t);   // owner[i] = 手 i を受けもつ ゆび（ptrs）の番号
  // 手の形を見て、必殺技を出す（形を作って手を止めると発動）。手ごとに形を見る
  gestureTrs.forEach((tr, k) => { const i = owner.indexOf(k); updateGesture(tr, i >= 0 ? [valid[i].raw] : [], t, TUNING.special); });
  if (state === 'play' && spGauge >= spMax()) {
    const d = decideSpecial(gestureTrs, TUNING.special, { coop: S.coop, waitSeconds: TUNING.coop.waitSeconds });
    const [a, b] = d ? d.trackers : [];
    if (d && fireSpecial(d.kind, a.x, a.y, d.merged ? { x: b.x, y: b.y } : null)) d.trackers.forEach(consumeGesture);
  }
}
// 検出した手の位置は「少し前のコマ」のもの。手を動かしていると、その遅れのぶん点が実際の手からずれて見える。
// 前回との差から速さを出し、遅れのぶんだけ先に進めた位置を使う（手を止めているときは何も変わらない）
function predictHands(t, frameSec) {
  const lag = Math.min(TUNING.ai.maxLead, (AI.ms + TUNING.ai.pipelineMs) / 1000 + frameSec * .5), prev = AI.prev, next = [];
  for (const h of AI.hands) {
    const w = h.raw[0]; let best = null, bd = 1e9;
    for (const q of prev) { const d = Math.hypot(q.pts[0].x - w.x, q.pts[0].y - w.y); if (d < bd) { bd = d; best = q; } }
    const span = best ? t - best.t : 0;
    if (best && bd < 220 && span > 0.004 && span < 0.25) {
      const sc = Math.min(1, TUNING.ai.maxLeadPx / Math.max(1, Math.hypot(h.raw[8].x - best.pts[8].x, h.raw[8].y - best.pts[8].y) / span * lag));
      h.pts = h.raw.map((p, i) => { const q = best.pts[i]; return { x: p.x + (p.x - q.x) / span * lag * sc, y: p.y + (p.y - q.y) / span * lag * sc }; });
    }
    next.push({ pts: h.raw, t });
  }
  AI.prev = next;
}
function switchToMotion() { runMode = 'motion'; Motion.reset(); AI.hands = []; AI.valid = 0; for (const p of ptrs) p.active = false; }

// ============================================================
//  ゆび（ポインタ）… AIの手 / マウス / タッチ のどれでも同じように扱う
// ============================================================
const mkPtr = color => ({ active: false, x: 0, y: 0, ox: 0, oy: 0, miss: 0, trail: [], color });
const ptrs = [mkPtr('#2ef2ff'), mkPtr('#ff2e88')];
function ptrMove(p, x, y, t, k) {
  if (!p.active) { p.active = true; p.x = x; p.y = y; p.ox = x; p.oy = y; p.trail.length = 0; }
  else {
    const nx = lerp(p.x, x, k), ny = lerp(p.y, y, k);
    if (Math.hypot(nx - p.x, ny - p.y) > 420) { p.x = x; p.y = y; p.ox = x; p.oy = y; p.trail.length = 0; }
    else { p.x = nx; p.y = ny; }
  }
  p.miss = 0; p.trail.push({ x: p.x, y: p.y, t }); if (p.trail.length > 16) p.trail.shift();
}
// 見つけた手を、ゆび（ptrs）にわりあてる。もどり値: 手ごとの ゆびの番号（わりあてられなかった手は -1）
function assignHands(hands, t) {
  const tips = hands.map(h => ({ x: clamp(h[8].x, 0, W), y: clamp(h[8].y, 0, H) }));   // 8番 = 人さし指の先
  const owner = tips.map(() => -1);
  ptrs.forEach((p, k) => {
    if (!p.active) return; let bi = -1, bd = 1e9;
    tips.forEach((q, i) => { if (owner[i] >= 0) return; const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; bi = i; } });
    // 止めているときはよく平均して「ぷるぷる」を消し、速く動かしたときはほぼそのまま追いかけて遅れを出さない
    if (bi >= 0 && bd < 260) { owner[bi] = k; ptrMove(p, tips[bi].x, tips[bi].y, t, clamp(TUNING.ai.smoothMin + bd / TUNING.ai.smoothDist, TUNING.ai.smoothMin, TUNING.ai.smoothMax)); }
  });
  tips.forEach((q, i) => {
    if (owner[i] >= 0) return;
    const order = S.coop && q.x >= W / 2 ? [1, 0] : [0, 1];   // ふたりモード: 左の人は水色、右の人はピンクのゆびになる
    const k = order.find(j => !ptrs[j].active);
    if (k !== undefined) { ptrMove(ptrs[k], q.x, q.y, t, 1); owner[i] = k; }
  });
  return owner;
}
function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function stagePoint(e) { const r = cv.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width * W, 0, W), y: clamp((e.clientY - r.top) / r.height * H, 0, H) }; }
const mouseOK = () => runMode === 'mouse' && state !== 'menu' && state !== 'loading' && state !== 'result';
stage.addEventListener('pointermove', e => { if (!mouseOK()) return; const p = stagePoint(e); ptrMove(ptrs[0], p.x, p.y, performance.now() / 1000, 1); });
stage.addEventListener('pointerdown', e => { if (!mouseOK()) return; const p = stagePoint(e); ptrMove(ptrs[0], p.x, p.y, performance.now() / 1000, 1); });
stage.addEventListener('pointerleave', () => { if (runMode === 'mouse') ptrs[0].active = false; });
stage.addEventListener('pointerup', e => { if (e.pointerType === 'touch') ptrs[0].active = false; });
// スタッフ用: 画面の左上を1.5びょう長おしすると、メニューにもどる（タッチ画面用）
let lpTimer = 0;
stage.addEventListener('pointerdown', e => {
  if (state === 'menu') return; const p = stagePoint(e);
  if (p.x < 80 && p.y < 80) { clearTimeout(lpTimer); lpTimer = setTimeout(() => { if (state === 'play') pauseGame(); else if (state !== 'menu') toMenu(); }, 1500); }
});
for (const n of ['pointerup', 'pointercancel', 'pointerleave']) stage.addEventListener(n, () => clearTimeout(lpTimer));

// ============================================================
//  ゲームの状態
// ============================================================
let state = 'menu', runMode = 'mouse', flowId = 0, skipResolve = null, frameCount = 0;
let monsters = [], fx = [], deco = [];
let score = 0, shown = 0, combo = 0, maxCombo = 0, comboT = 0, kills = 0, bombs = 0, feverT = 0, timeLeft = 30, elapsed = 0, spawnT = 0, starCool = 0;
let shake = 0, flashRed = 0, hitStop = 0, gridPhase = 0, readyT = 0, readyLock = 0, readyShown = '', starting = false;
let cdT = 0, cdStage = -1, finT = 0, finWiping = false, hintT = 0, lastShown = false, lastSec = 99;
let entry = null, entryDefault = '', lastAt = 0, autoT = 0, autoMsg = '', resultSeq = 0, resultArmed = false;
let attractT = 0, attractPage = 0, loadTipT = 0, wakeLock = null;
let shots = [], shotT = 0, reflects = 0, shotHits = 0, cracks = [], attackHinted = false;
let boss = null, bossAppeared = false, bossDefeated = false;
let previousGhost = null, ghostSamples = [], ghostNextSample = 0;
let rev = createComeback();   // 逆転ゲージ（激ムズ）
let spGauge = 0, barrierT = 0, spFullShown = false, gestureTrs = [createGestureTracker(), createGestureTracker()];   // ジェスチャー必殺技（ゆびごとに手の形を見る）
let merges = 0, pkills = [0, 0];   // ふたりモード: 合体技を出した回数と、水色・ピンクがそれぞれ斬ってたおした数
const revOn = () => comebackEnabled(TUNING.comeback, S.diff), revActive = () => revOn() && comebackActive(rev);
const spMax = () => S.coop ? TUNING.coop.gaugeMax : TUNING.special.gaugeMax;   // 必殺ゲージの満タン
// assets に bg.mp3（または bgm.mp3 / .ogg / .m4a / .wav）を入れると、プレイ中のBGMになる
const BGM_URL = qs.get('assets') === '0' ? null : Object.values(import.meta.glob('../../assets/{bg,bgm}.{mp3,ogg,m4a,wav}', { eager: true, query: '?url', import: 'default' }))[0] || null;
const { Snd, Music } = createAudio({ TUNING, getSound: () => S.sound, getTimeLeft: () => timeLeft, getFever: () => feverT, bgmUrl: BGM_URL });
const effectState = { get fx() { return fx; }, set fx(value) { fx = value; } };
const { burst, ring, addText: addTextRaw, addSlash, confetti, updateFx } = createEffects({ state: effectState, clamp, rnd, pick, TAU, W, FX, FB });
// ---- 文字を少なくする表示（激ムズ）: 敵や火の玉が多いので、画面にうかぶ文字をへらして見やすくする ----
const quietUi = () => TUNING.quietUi.difficulties.includes(S.diff);
function addText(x, y, text, ...rest) {
  if (quietUi()) {   // 大きな点数・ダメージの数字だけ出す（+10 や「あと2」「はじいた！」は出さない）
    const m = /^[+\-−](\d+)/.exec(text);
    if (!m || Number(m[1]) < TUNING.quietUi.minTextPoints) return;
  }
  addTextRaw(x, y, text, ...rest);
}
const attackState = {
  get shots() { return shots; },
  set shots(value) { shots = value; },
  get shotT() { return shotT; },
  set shotT(value) { shotT = value; },
  get timeLeft() { return timeLeft; },
  set timeLeft(value) { timeLeft = value; },
  get monsters() { return monsters; },
  set monsters(value) { monsters = value; },
  get reflects() { return reflects; },
  set reflects(value) { reflects = value; },
  get shotHits() { return shotHits; },
  set shotHits(value) { shotHits = value; },
  get combo() { return combo; },
  set combo(value) { combo = value; },
  get comboT() { return comboT; },
  set comboT(value) { comboT = value; },
  get score() { return score; },
  set score(value) { score = value; },
  get shake() { return shake; },
  set shake(value) { shake = value; },
  get flashRed() { return flashRed; },
  set flashRed(value) { flashRed = value; },
  get attackHinted() { return attackHinted; },
  set attackHinted(value) { attackHinted = value; },
  get cracks() { return cracks; },
  set cracks(value) { cracks = value; },
  get feverT() { return feverT; },
  set feverT(value) { feverT = value; },
};
const { updateAttacks, launchShot, reflectShot } = createAttacks({ TUNING, MON, S, state: attackState, rnd, rndi, pick, clamp, lerp, TAU, W, H, Snd, banner, bumpCombo, multOf, burst, ring, addSlash, addText, isBossActive: () => !!boss && boss.hp > 0, onDamage: () => comebackDamage(), isBarrier: () => barrierT > 0, isQuiet: () => quietUi() });

const screens = { menu: $('#menu'), loading: $('#loading'), ready: $('#ready'), result: $('#result'), paused: $('#pause') };
function setState(s) {
  state = s;
  for (const k in screens) screens[k].classList.toggle('on', k === s);
  stage.classList.toggle('booth', S.booth);
  $('#bar').classList.toggle('on', !S.booth && (s === 'ready' || s === 'countdown' || s === 'play' || s === 'paused'));
}
let toastTimer = 0;
function toast(msg, ms = 4000) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), ms); }
// ---- 演出（大きな文字）と、画面切りかえのワイプ ----
const fxEl = $('#fx'), wipeEl = $('#wipe');
function banner(text, cls, ms, sub) {
  if (quietUi()) sub = '';   // 文字を少なくする表示では、小さい説明文を出さない
  const el = document.createElement('div'); el.className = 'bn ' + cls; el.style.animationDuration = ms + 'ms';
  if (/\b(call|bomb)\b/.test(cls) && fxEl.querySelector('.bn.band')) el.classList.add('low');   // 帯つきの演出と重ならないように
  const s = document.createElement('span'); s.textContent = text; el.appendChild(s);
  if (sub) { const b = document.createElement('small'); b.textContent = sub; el.appendChild(b); }
  fxEl.appendChild(el); setTimeout(() => el.remove(), ms + 60);
  while (fxEl.children.length > 6) fxEl.firstChild.remove();
}
function wipeTo(fn) {
  if (reduceMotion) { fn(); return; }
  wipeEl.classList.remove('go'); void wipeEl.offsetWidth; wipeEl.classList.add('go'); Snd.swish();
  setTimeout(fn, 300);
}

// ---- モンスターの出現 ----
function spawn(type, ov) {
  const T = MON[type], sp = diffCfg().speed * (T.speed || 1);   // むずかしさの速さ × モンスター改造の「速さ」
  const m = { type, r: T.r, hr: T.hr || T.r, hp: T.hp, maxHp: T.hp, x: 0, y: 0, vx: 0, vy: 0, g: 0, age: 0, ph: rnd(0, TAU), flash: 0, cool: 0, dead: false };
  if (type === 'slime' || type === 'bomb' || type === 'star') {
    m.x = rnd(90, W - 90); m.y = H + 40; m.vy = -rnd(560, 700) * sp * (type === 'star' ? .9 : 1); m.g = 520 * sp * sp; m.vx = ((W / 2 - m.x) * rnd(.15, .4)) * sp + rnd(-50, 50);
  } else if (type === 'ghost') {
    const dir = Math.random() < .5 ? 1 : -1; m.x = dir > 0 ? -50 : W + 50; m.y0 = rnd(150, 380); m.y = m.y0; m.vx = dir * rnd(110, 170) * sp; m.amp = rnd(30, 70); m.freq = rnd(.5, .9) * sp;
  } else if (type === 'bat') {
    m.x = rnd(80, W - 80); m.y = -40; const tx = rnd(80, W - 80), ty = rnd(300, H + 40), a = Math.atan2(ty - m.y, tx - m.x), s = rnd(280, 360) * sp;
    m.vx = Math.cos(a) * s; m.vy = Math.sin(a) * s; m.zig = rnd(40, 90); m.zf = rnd(5, 8);
  } else if (type === 'golem') {
    m.x = rnd(200, W - 200); m.y = H + 60; m.vy = -rnd(400, 450) * sp; m.g = 260 * sp * sp; m.vx = (W / 2 - m.x) * .2 * sp;
  }
  Object.assign(m, ov || {}); monsters.push(m); return m;
}
function chooseType() {
  const D = diffCfg(), w = { slime: 40 };
  if (elapsed > 3) w.ghost = 24;
  if (elapsed > 7) w.bat = 16;
  if (elapsed > 10 && !monsters.some(m => m.type === 'golem')) w.golem = 7;
  if (elapsed > 5) w.bomb = D.bomb * 100;
  if (elapsed > 8 && feverT <= 0 && starCool <= 0) w.star = 3;
  for (const k in w) w[k] *= MON[k].freq;   // モンスター改造の「出やすさ」（0 なら出ない）
  const keys = Object.keys(w).filter(k => w[k] > 0);
  if (!keys.length) return null;   // ぜんぶ「出ない」にしたとき
  let r = Math.random() * keys.reduce((s, k) => s + w[k], 0), type = keys[0];
  for (const k of keys) { r -= w[k]; if (r <= 0) { type = k; break; } }
  if (type === 'bomb' && monsters.filter(m => m.type === 'bomb').length >= (D.maxBombs ?? 2)) type = w.slime > 0 ? 'slime' : null;
  if (type === 'star') starCool = 16;
  return type;
}
function updateSpawner(dt) {
  if (starCool > 0) starCool -= dt;
  const maxMonsters = boss && boss.hp > 0 ? TUNING.boss.maxMonsters : S.coop ? TUNING.coop.maxMonsters : TUNING.maxMonsters;
  spawnT -= dt; if (spawnT > 0 || monsters.length >= maxMonsters) return;
  const p = elapsed / S.time, D = diffCfg();
  spawnT = D.spawn * (S.coop ? TUNING.coop.spawn : 1) * (1 - .45 * p) * rnd(.75, 1.25) * (feverT > 0 ? .65 : 1);
  const n = (Math.random() < .12 && elapsed > 5) ? rndi(2, 3) : 1;
  for (let i = 0; i < n && monsters.length < maxMonsters; i++) { const type = chooseType(); if (type) spawn(type); }
}
function updateMonster(m, dt) {
  m.age += dt; if (m.flash > 0) m.flash -= dt; if (m.cool > 0) m.cool -= dt;
  if (m.type === 'ghost') { m.x += m.vx * dt; m.y = m.y0 + Math.sin(m.age * TAU * m.freq + m.ph) * m.amp; if (m.x < -90 || m.x > W + 90) m.dead = true; }
  else if (m.type === 'bat') {
    m.x += m.vx * dt + Math.cos(m.age * m.zf) * m.zig * dt; m.y += m.vy * dt + Math.sin(m.age * m.zf) * m.zig * dt * .5;
    if (m.y > H + 90 || m.x < -90 || m.x > W + 90 || m.y < -110) m.dead = true;
  } else { m.vy += m.g * dt; m.x += m.vx * dt; m.y += m.vy * dt; if (m.y > H + 90 && m.vy > 0) m.dead = true; }
}

// ---- 当たり判定とスコア ----
function multOf(c) { return comboMultiplier(c, feverT > 0) * (revActive() ? TUNING.comeback.mult : 1); }
function maybeSpawnBoss() {
  if (!shouldSpawnBoss(S.boss, bossAppeared, timeLeft, S.coop ? TUNING.coop.bossAppearAt : TUNING.boss.appearAt)) return;
  bossAppeared = true;
  boss = createBoss(S.coop ? { ...TUNING.boss, hp: Math.round(TUNING.boss.hp * TUNING.coop.bossHp) } : TUNING.boss, W);   // ふたりモードは HPが多い
  if (monsters.length > TUNING.boss.maxMonsters) monsters.length = TUNING.boss.maxMonsters;
  shots = [];
  banner('キングがあらわれた！', 'warn band', 1800, S.coop ? 'ふたりで力を合わせて たおそう！' : '');
  Snd.alarm();
}
function onBossHit(result, big = false) {
  burst(boss.x, boss.y, TUNING.boss.color, big ? 34 : 14, big ? 420 : 260, .55);
  addText(boss.x, boss.y - TUNING.boss.radius, `-${result.damage}`, '#ffffff', big ? 44 : 28);
  if (result.defeated) {
    bossDefeated = true;
    score += result.bonus;
    ring(boss.x, boss.y, TUNING.boss.color, TUNING.boss.radius * 2);
    banner('ボスをたおした！', 'call c5', 1700, `+${result.bonus}点`);
    Snd.big();
    confetti(70);
  } else {
    Snd.hurt();
  }
}
function testHits(dt = 0) {
  if (boss && boss.hp > 0) {
    for (const p of ptrs) {
      if (!p.active) continue;
      const speed = dt > 0 ? Math.hypot(p.x - p.ox, p.y - p.oy) / dt : 0;
      if (speed < TUNING.boss.minSpeed || segDist(p.ox, p.oy, p.x, p.y, boss.x, boss.y) > TUNING.boss.radius) continue;
      const result = damageBoss(boss, speed, TUNING.boss);
      if (!result.applied) continue;
      onBossHit(result);
      break;
    }
  }
  const pad = diffCfg().pad;
  for (const m of monsters) {
    if (m.dead || m.cool > 0) continue;
    let hit = false, hp = null;
    if (runMode === 'motion') { if (Motion.coverage(m.x, m.y, m.hr * .95) >= .2) hit = true; }
    else for (const p of ptrs) { if (p.active && segDist(p.ox, p.oy, p.x, p.y, m.x, m.y) <= m.hr + pad) { hit = true; hp = p; break; } }
    if (hit) onHit(m, hp);
  }
  for (const s of shots) {   // 飛んでくる火の玉を斬ったら、はじき返す
    if (s.st !== 'fly') continue;
    let hit = false, hp = null;
    if (runMode === 'motion') { if (Motion.coverage(s.x, s.y, Math.max(22, s.r)) >= .2) hit = true; }
    else for (const p of ptrs) { if (p.active && segDist(p.ox, p.oy, p.x, p.y, s.x, s.y) <= s.r + pad * .6 + 8) { hit = true; hp = p; break; } }
    if (hit) reflectShot(s, hp);
  }
  for (const p of ptrs) { p.ox = p.x; p.oy = p.y; }
}
function onHit(m, p) {
  const T = MON[m.type];
  let dx = p ? p.x - p.ox : rnd(-1, 1), dy = p ? p.y - p.oy : rnd(-1, 1); const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  const ang = Math.atan2(dy, dx);
  if (T.bad) { bombHit(m); return; }
  m.hp--; m.flash = .15; m.cool = .3;
  addSlash(m.x, m.y, ang, m.r);
  if (m.hp > 0) { burst(m.x, m.y, T.color, 8, 220, .5); Snd.hurt(); shake = Math.max(shake, .25); addText(m.x, m.y - m.r - 8, `あと${m.hp}`, '#fff', 20); return; }
  m.by = p ? ptrs.indexOf(p) : -1;   // どのゆびが たおしたか（ふたりモードのけっかで使う）
  kill(m, ang);
}
function kill(m) {
  const T = MON[m.type]; m.dead = true; kills++; addSpecial(1);
  if (m.by >= 0) pkills[m.by]++;
  bumpCombo();
  if (T.fever) {
    feverT = Math.min(TUNING.feverSeconds * 1.5, feverT + TUNING.feverSeconds);
    banner('FEVER TIME!!', 'fever band', 1500, `${TUNING.feverSeconds}びょう間 とくてん2ばい`); ring(m.x, m.y, T.color, 160); Snd.star();
  }
  const mult = multOf(combo), pts = T.pts * mult; score += pts;
  burst(m.x, m.y, T.color, m.type === 'golem' ? 30 : 16, m.type === 'golem' ? 380 : 280, .75); ring(m.x, m.y, T.color, m.r * 2.2);
  addText(m.x, m.y - 8, `+${pts}`, mult > 1 ? '#ffe66b' : '#a6ff3d', 26 + Math.min(12, mult * 2));
  if (m.type === 'golem') { Snd.big(); shake = Math.max(shake, .55); hitStop = .07; } else Snd.hit(combo);
}
function bumpCombo() {
  combo = (comboT > 0 ? combo : 0) + 1; comboT = TUNING.comboWindow; maxCombo = Math.max(maxCombo, combo);
  const call = CALLS.find(c => c[0] === combo);
  if (call) { if (!quietUi()) banner(call[1], 'call ' + call[2], 950); Snd.chime(CALLS.indexOf(call)); }   // GOOD! などは音だけにする
}
function bombHit(m) {
  if (revActive()) { goldBomb(m); return; }
  if (barrierT > 0) { defuseBomb(m, 'ガード！'); return; }   // ✌バリア中は、ばくだんにさわってもへらない
  m.dead = true; bombs++; combo = 0; comboT = 0; timeLeft = Math.max(0, timeLeft - TUNING.bombPenaltySeconds); score = Math.max(0, score - 50);
  shake = 1; flashRed = 1; burst(m.x, m.y, '#ff4d5e', 30, 420, .9); burst(m.x, m.y, '#ffd24d', 18, 300, .7); ring(m.x, m.y, '#ff4d5e', 170);
  if (!quietUi()) banner('BOMB!', 'bomb', 900, `−${TUNING.bombPenaltySeconds}びょう`); Snd.bomb();
  comebackDamage();
}
// ---- ジェスチャー必殺技: 敵をたおすとゲージがたまり、満タンで ✋パー・✌ピース・✊グー の形を見せて止めると発動 ----
const GESTURE_ICONS = { open: '✋', peace: '✌', fist: '✊' };
function addSpecial(n) {
  const max = spMax(); if (spGauge >= max) return;
  spGauge = Math.min(max, spGauge + n);
  if (spGauge >= max && !spFullShown && state === 'play') {
    spFullShown = true;
    const sub = runMode !== 'ai' ? '1・2・3 キーで発動' : S.coop ? 'ふたりで同じ形をすると 合体技！' : '✋ ✌ ✊ の形で 手を止めよう';
    banner('必殺技 OK!', 'call c2', 1300, sub);
    Snd.chime(3);
  }
}
function defuseBomb(m, label) {   // ばくだんを安全に消す（時間はへらない）
  m.dead = true; burst(m.x, m.y, '#9fb3c8', 16, 260, .6); ring(m.x, m.y, '#7df9ff', 90);
  addText(m.x, m.y - m.r - 10, label, '#7df9ff', 22, 1);
}
// partner: ふたりモードで、もう1人も同じ形をしているときの その手の位置 → 合体技になる
function fireSpecial(kind, x = W / 2, y = H / 2, partner = null) {
  const C = TUNING.special;
  if (state !== 'play' || spGauge < spMax() || !GESTURE_NAMES[kind]) return false;
  if (partner && S.coop) { fireMerged(kind, x, y, partner.x, partner.y); merges++; }
  else if (kind === 'open') {   // ✋パー「しょうげきは」: まわりの敵をまとめてたおし、ばくだんは消し、火の玉ははじく
    ring(x, y, '#2ef2ff', C.waveRadius * 2); ring(x, y, '#ffffff', C.waveRadius * 1.3); burst(x, y, '#2ef2ff', 40, 520, .8);
    for (const m of monsters) {
      if (m.dead || Math.hypot(m.x - x, m.y - y) > C.waveRadius + m.r) continue;
      if (MON[m.type].bad) defuseBomb(m, 'ふっとばした！'); else kill(m);
    }
    for (const s of shots) if ((s.st === 'charge' || s.st === 'fly') && Math.hypot(s.x - x, s.y - y) <= C.waveRadius + s.r) reflectShot(s, null);
    banner('しょうげきは！', 'call c4', 1100, '✋ パー'); Snd.big(); shake = Math.max(shake, .8);
  } else if (kind === 'peace') {   // ✌ピース「バリア」: しばらく、火の玉を自動ではじき、ばくだんも平気になる
    barrierT = C.barrierSeconds;
    ring(x, y, '#7df9ff', 200); burst(x, y, '#7df9ff', 24, 300, .6);
    banner('バリア！', 'call c3', 1100, `✌ ピース　${C.barrierSeconds}びょう 火の玉もばくだんも平気`); Snd.star();
  } else {   // ✊グー「ゲンコツ」: ボスに大ダメージ。ボスがいないときは、画面じゅうの敵に1ダメージ
    if (boss && boss.hp > 0) {
      const result = punchBoss(boss, C.punchDamage, TUNING.boss);
      ring(boss.x, boss.y, '#ffd23f', TUNING.boss.radius * 2.6); onBossHit(result, true);
    } else {
      for (const m of monsters) {
        if (m.dead || MON[m.type].bad) continue;
        m.hp--; m.flash = .15;
        if (m.hp <= 0) kill(m); else addText(m.x, m.y - m.r - 8, `あと${m.hp}`, '#fff', 20);
      }
    }
    banner('ゲンコツ！', 'call c5', 1100, '✊ グー'); Snd.impact(); shake = 1; hitStop = .08;
  }
  spGauge = 0; spFullShown = false;   // 技でたおした敵のぶんは、ゲージに入れない（満タンの間は addSpecial が何もしない）
  return true;
}
// ---- 合体技（ふたりモード）: 2人が同時に同じ手の形で止めると、ふつうの技より強くなる ----
function fireMerged(kind, ax, ay, bx, by) {
  const C = TUNING.special, M = TUNING.coop, mx = (ax + bx) / 2, my = (ay + by) / 2;
  const half = Math.hypot(bx - ax, by - ay) / 2;
  addSlash(mx, my, Math.atan2(by - ay, bx - ax), half / 2.4);   // 2人の手を、光の線でつなぐ
  for (let i = 0; i <= 6; i++) burst(lerp(ax, bx, i / 6), lerp(ay, by, i / 6), '#ffd23f', 6, 260, .6);
  ring(mx, my, '#ffd23f', 240); confetti(50);
  let name;
  if (kind === 'open') {   // ✋✋ ダブルしょうげきは: 2人の手から大きなしょうげきは ＋ 2人の手をむすぶビーム。火の玉はぜんぶはじく
    name = 'ダブルしょうげきは';
    const R = C.waveRadius * M.waveScale;
    for (const [x, y] of [[ax, ay], [bx, by]]) { ring(x, y, '#2ef2ff', R * 2); burst(x, y, '#2ef2ff', 30, 520, .8); }
    for (const m of monsters) {
      if (m.dead) continue;
      const inWave = Math.hypot(m.x - ax, m.y - ay) <= R + m.r || Math.hypot(m.x - bx, m.y - by) <= R + m.r;
      if (!inWave && segDist(ax, ay, bx, by, m.x, m.y) > M.beamWidth + m.r) continue;
      if (MON[m.type].bad) defuseBomb(m, 'ふっとばした！'); else kill(m);
    }
    for (const s of shots) if (s.st === 'charge' || s.st === 'fly') reflectShot(s, null);
    Snd.big(); shake = 1;
  } else if (kind === 'peace') {   // ✌✌ ダブルバリア: 長いバリア ＋ フィーバー（とくてん2ばい）
    name = 'ダブルバリア';
    barrierT = M.barrierSeconds;
    feverT = Math.min(TUNING.feverSeconds * 1.5, feverT + TUNING.feverSeconds);
    for (const [x, y] of [[ax, ay], [bx, by]]) ring(x, y, '#7df9ff', 220);
    Snd.star();
  } else {   // ✊✊ ダブルゲンコツ: ボスに特大ダメージ。ボスがいないときは、画面じゅうの敵をたおし、ばくだんも消す
    name = 'ダブルゲンコツ';
    if (boss && boss.hp > 0) {
      const result = punchBoss(boss, M.punchDamage, TUNING.boss);
      ring(boss.x, boss.y, '#ffd23f', TUNING.boss.radius * 3.2); onBossHit(result, true);
    } else {
      for (const m of monsters) { if (m.dead) continue; if (MON[m.type].bad) defuseBomb(m, 'ドカン！'); else kill(m); }
    }
    Snd.impact(); shake = 1; hitStop = .1;
  }
  banner(name + '！', 'call c5', 1400, `ふたりの合体技　${GESTURE_ICONS[kind].repeat(2)}`);
  Snd.fanfare();
}
// ---- 逆転ゲージ（激ムズ）: ダメージを受けるとたまり、満タンで「逆転タイム」 ----
function comebackDamage() {
  if (!revOn() || !addComebackDamage(rev, TUNING.comeback)) return;
  const C = TUNING.comeback;
  timeLeft += C.timeBonus;
  banner('逆転タイム!!', 'fever band', 1700, `${C.seconds}びょう間 とくてん${C.mult}ばい！ ばくだんが金色に`);
  ring(W / 2, H / 2, '#ffd23f', 260); confetti(40); Snd.star();
}
// 逆転タイム中のばくだんは「金のばくだん」。さわると爆発して、まわりの敵をまとめてたおす
function goldBomb(m) {
  const C = TUNING.comeback; m.dead = true; kills++;
  bumpCombo();
  const pts = C.bombPts * multOf(combo); score += pts;
  burst(m.x, m.y, '#ffd23f', 34, 460, .9); burst(m.x, m.y, '#ffffff', 16, 320, .6); ring(m.x, m.y, '#ffd23f', C.blastRadius * 2);
  addText(m.x, m.y - 8, `+${pts}`, '#ffe66b', 34);
  shake = Math.max(shake, .6); Snd.big();
  for (const o of monsters) {
    if (o.dead || Math.hypot(o.x - m.x, o.y - m.y) > C.blastRadius) continue;
    if (MON[o.type].bad) goldBomb(o); else kill(o);   // となりの金のばくだんも連鎖する
  }
}
// ---- てきの攻撃（火の玉）: 遠くから大きくなりながら飛んでくる。斬ればはじき返せる ----
async function startFlow() {
  const my = ++flowId; Snd.init(); keepAwake();
  setState('loading'); loadTipT = 0; $('#loadTip').textContent = tipText();
  showLoading('カメラを準備しています…', 'ブラウザに「カメラを使う」と出たら、「許可」をおしてね。', false, true);
  runMode = S.mode;
  if (runMode !== 'mouse') {
    try { await Cam.start(); }
    catch (e) { if (my !== flowId) { Cam.stop(); return; } toast(camMessage(e), 8000); runMode = 'mouse'; Cam.stop(); }
  }
  if (my !== flowId) { Cam.stop(); return; }
  if (runMode === 'ai') {
    showLoading('AIを準備しています…', 'はじめては少し時間がかかります（目安: 10〜40びょう）。次からは早くなります。', true, true);
    const res = await Promise.race([AI.ensure().then(() => 'ok', () => 'fail'), new Promise(r => { skipResolve = () => r('skip'); })]);
    skipResolve = null; if (my !== flowId) { Cam.stop(); return; }
    if (res !== 'ok') { runMode = 'motion'; toast(res === 'skip' ? 'モーションモードで始めます' : 'AIを読みこめなかったので、モーションモードで始めます。ネットの接続を確認してね。', 7000); }
  }
  if (runMode === 'motion') Motion.reset();
  AI.hands = []; AI.valid = 0; AI.lastVT = -1; for (const p of ptrs) { p.active = false; p.trail.length = 0; }
  enterReady(false);
}
function showLoading(msg, sub, canSkip, canCancel) {
  $('#loadMsg').textContent = msg; $('#loadSub').textContent = sub || '';
  $('#skipAI').style.display = canSkip ? '' : 'none'; $('#cancelLoad').style.display = canCancel ? '' : 'none';
  $('#loadMeter').style.visibility = canSkip ? 'visible' : 'hidden'; if (canSkip) $('#loadBar').style.width = '0%';
}
function updateLoading(dt) { loadTipT += dt; if (loadTipT > 3.5) { loadTipT = 0; $('#loadTip').textContent = tipText(); } }

// ---- 待機画面 ----
const READY_TEXT = {
  booth: { ai: '手をカメラにかざすとスタート！', motion: '手を大きくふるとスタート！', mouse: 'マウスを動かすとスタート' },
  normal: { ai: '手をカメラにかざすとスタート！', motion: '手を大きくふるとスタート！', mouse: 'マウスを動かすとスタート（タッチはなぞる）' },
  coop: { ai: 'ふたりで1つずつ 手をかざすとスタート！', motion: 'ふたりで手を大きくふるとスタート！', mouse: 'マウスを動かすとスタート' },
};
function setReadyText() {
  const m = readyLock > 0 ? (S.coop ? 'つぎの ふたり、どうぞ！' : 'つぎの人、どうぞ！')
    : S.coop && runMode === 'ai' && AI.valid === 1 ? 'あと ひとり、手をかざしてね！'   // ふたりモードは、2つの手がそろうとスタート
    : READY_TEXT[S.coop ? 'coop' : S.booth ? 'booth' : 'normal'][runMode];
  if (m !== readyShown) {
    readyShown = m; $('#readyText').textContent = m; $('#cta').classList.toggle('lock', readyLock > 0);
    $('#cta .next').textContent = S.coop ? 'NEXT PLAYERS!' : 'NEXT PLAYER!';
  }
}
// lock=true: 前の人がまだ前にいても、すぐには始まらないように少し待つ
function enterReady(lock) {
  readyT = 0; readyLock = lock && S.booth ? 2.5 : 0; starting = false; monsters = []; shots = []; cracks = []; feverT = 0; Music.stop();
  readyShown = ''; setReadyText(); setHold(0); attractT = 0; setAttractPage(0); setState('ready'); renderBoard();
}
const HOLD_C = 263.9;
function setHold(p) { $('#holdRing').style.strokeDashoffset = String(HOLD_C * (1 - clamp(p, 0, 1))); }
function setAttractPage(i) {
  attractPage = i;
  document.querySelectorAll('#ready .a-page').forEach((el, j) => el.classList.toggle('on', j === i));
  document.querySelectorAll('#aDots i').forEach((el, j) => el.classList.toggle('on', j === i));
}
function updateReady(dt) {
  attractT += dt; if (attractT > TUNING.attractPageSeconds) { attractT = 0; setAttractPage((attractPage + 1) % 3); }
  if (starting) return;
  if (readyLock > 0) { readyLock = Math.max(0, readyLock - dt); readyT = 0; setHold(0); setReadyText(); return; }
  setReadyText();
  const ok = runMode === 'ai' ? AI.valid >= (S.coop ? 2 : 1) : runMode === 'motion' ? Motion.energy > .012 : ptrs[0].active;
  readyT = ok ? readyT + dt : Math.max(0, readyT - dt * 2);
  setHold(readyT / .9);
  if (readyT >= .9) beginGame();
}
function beginGame() {
  if (starting || state !== 'ready') return; starting = true; Snd.select();
  wipeTo(() => { starting = false; if (state === 'ready') startCountdown(); });
}
function resetRound() {
  monsters = []; fx = []; score = 0; shown = 0; combo = 0; maxCombo = 0; comboT = 0; kills = 0; bombs = 0; feverT = 0; starCool = 0;
  timeLeft = S.time; elapsed = 0; spawnT = .6; shake = 0; flashRed = 0; hitStop = 0; lastShown = false; lastSec = 99;
  shots = []; cracks = []; shotT = TUNING.attacks.startAfter; reflects = 0; shotHits = 0; attackHinted = false;
  boss = null; bossAppeared = false; bossDefeated = false; rev = createComeback();
  spGauge = TUNING.special.startGauge; barrierT = 0; spFullShown = false; gestureTrs = [createGestureTracker(), createGestureTracker()];
  merges = 0; pkills = [0, 0];
  previousGhost = S.ghost ? unpackGhost(store.get(ghostKey(), null), TUNING.ghost) : null;
  ghostSamples = []; ghostNextSample = 0;
}
function recordGhostSamples() {
  if (!S.ghost) return;
  while (ghostNextSample <= elapsed && ghostNextSample <= TUNING.ghost.maxDuration) {
    ghostSamples.push(createGhostSample(ghostNextSample, ptrs, score, TUNING.ghost.interval));
    ghostNextSample = Number((ghostNextSample + TUNING.ghost.interval).toFixed(4));
  }
}
// ---- READY? → 3 → 2 → 1 → START! ----
function startCountdown() { resetRound(); cdT = 0; cdStage = -1; setState('countdown'); }
function updateCountdown(dt) {
  cdT += dt; const st = cdT < 1 ? 0 : cdT < 2 ? 1 : cdT < 3 ? 2 : cdT < 4 ? 3 : 4;
  if (st === cdStage) return; cdStage = st;
  if (st === 0) { banner('READY?', 'ready band', 1000); Snd.ready(); }
  else if (st <= 3) { banner(String(4 - st), 'num', 900); Snd.count(); }
  else {
    banner('START!', 'start', 850); Snd.go();
    for (const p of ptrs) { p.ox = p.x; p.oy = p.y; }
    setState('play'); hintT = 0; Music.start();
  }
}
function updatePlay(dt) {
  if (hitStop > 0) { hitStop -= dt; return; }   // 大きな敵をたおした瞬間だけ、ほんの少し止める（手ごたえの演出）
  elapsed += dt; hintT += dt; timeLeft -= dt;
  if (feverT > 0) feverT = Math.max(0, feverT - dt);
  tickComeback(rev, dt);
  if (barrierT > 0) barrierT = Math.max(0, barrierT - dt);
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
  maybeSpawnBoss();
  updateBoss(boss, dt, TUNING.boss, W, H);
  updateSpawner(dt);
  for (const m of monsters) updateMonster(m, dt);
  updateAttacks(dt);
  testHits(dt);
  monsters = monsters.filter(m => !m.dead);
  recordGhostSamples();
  if (!lastShown && timeLeft <= 10 && S.time > 12) { lastShown = true; if (!quietUi()) banner('ラスト10びょう！', 'last band', 1400); Snd.alarm(); }   // 時計が赤くなるので、帯は出さなくてもわかる
  const sec = Math.ceil(timeLeft); if (sec !== lastSec) { lastSec = sec; if (sec <= 5 && sec > 0) Snd.tick(); }
  if (timeLeft <= 0) { timeLeft = 0; finishRound(); }
}
function finishRound() { rev = createComeback(); barrierT = 0; setState('finish'); finT = 0; finWiping = false; Music.stop(); banner('FINISH!', 'finish', 1600); Snd.whistle(); }
function updateFinish(dt) {
  finT += dt;
  if (finT >= 1.6 && !finWiping) { finWiping = true; wipeTo(() => { if (state === 'finish') endRound(); }); }
}
const SECRETS = [
  'AIは、手の <b>21か所の関節の点</b> を、1秒に何十回もさがしています。',
  '「モーション」モードは、AIではなく <b>前の映像とのちがい</b> を見ているだけ。これも立派な画像処理です。',
  'コンピューターは、写真を <b>数字のあつまり</b> として見ています。うごきも、数字の変化でわかるんだ。',
  'カメラの映像は、この画面の中だけで処理されます。<b>外には送っていません</b>。',
  'ゲームの敵の速さや数は、プログラムの <b>数字</b> で決まっています。数字を変えると、ゲームが変わるよ。',
  '手の動きをとらえる技術は、<b>手話の認識やスポーツのフォーム分析</b>などにも使われています。',
];
function rankOf(sc) { return rankForScore(sc, S.time, S.diff, S.coop ? TUNING.coop.rankScale : 1); }
// ---- 記録（この端末のブラウザの中だけに保存）----
// ふたりモードの記録には c: 1 をつけ、ランキングは「ひとり」「ふたり」で分ける（2人のほうが点が出やすいので）
const dayKey = ts => { const d = new Date(ts || 0); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
// モンスター改造で遊んだ記録には x: 1 をつけ、ランキングとゴーストを分ける（点数を変えると、くらべられないので）
const sameStyle = e => !!e.c === S.coop && !!e.x === customOn;
const ghostKey = () => 'ghost' + (S.coop ? 'Coop' : '') + (customOn ? 'Mod' : '');
const GHOST_KEYS = ['ghost', 'ghostCoop', 'ghostMod', 'ghostCoopMod'];
const whoBefore = () => S.coop ? '前のペア' : '前の人';
function allScores() { const l = store.get('scores', []); return Array.isArray(l) ? l.filter(e => e && typeof e.s === 'number') : []; }
function todayScores() { const k = dayKey(Date.now()); return allScores().filter(e => dayKey(e.at) === k).sort((a, b) => b.s - a.s); }
function todayStyle() { return todayScores().filter(sameStyle); }
function saveScores(list) {   // 今日の記録はぜんぶ、ほかの日はベスト50だけ残す
  const k = dayKey(Date.now());
  const td = list.filter(e => dayKey(e.at) === k).slice(-2950), old = list.filter(e => dayKey(e.at) !== k).sort((a, b) => b.s - a.s).slice(0, 50);
  store.set('scores', td.concat(old));
}
// ---- けっか画面（順番に出していく）----
function endRound() {
  Music.stop(); feverT = 0;
  if (S.ghost && ghostSamples.length) store.set(ghostKey(), packGhost(ghostSamples, TUNING.ghost));
  const rk = rankOf(score), em = $('#emblem'); $('#rankLetter').textContent = rk; em.dataset.rank = rk;
  $('#resScore').textContent = '0'; $('#resCombo').textContent = String(maxCombo); $('#resKills').textContent = String(kills); $('#resBombs').textContent = String(bombs);
  $('#resReflect').textContent = String(reflects); $('#st4').hidden = !S.attack; $('#rStats').classList.toggle('four', S.attack);
  const bossRemaining = bossAppeared && !bossDefeated && boss && boss.hp > 0;
  $('#bossResult').hidden = !bossRemaining;
  if (bossRemaining) $('#bossResult').textContent = `ボスのHP 残り${Math.round(boss.hp / boss.maxHp * 100)}%`;
  const ghostResult = S.ghost ? ghostResultText(score, previousGhost, whoBefore()) : '';
  $('#ghostResult').hidden = !ghostResult;
  if (ghostResult) $('#ghostResult').textContent = ghostResult;
  const notes = [];   // スコアの右に出すメモ: ふたりモードの 2人それぞれの たおした数・合体技の回数、モンスター改造中かどうか
  if (S.coop && pkills[0] + pkills[1] > 0) notes.push(`水色 ${pkills[0]}体・ピンク ${pkills[1]}体`);
  if (S.coop && runMode === 'ai') notes.push(`合体技 ${merges}回`);
  if (customOn) notes.push('改造モンスターで プレイ！');
  $('#resNote').hidden = !notes.length;
  $('#resNote').textContent = notes.join('\n');
  $('#secret').innerHTML = '<b>AIのひみつ</b>　' + pick(SECRETS);
  const nm = $('#nameInput');
  const before = S.booth ? todayStyle() : allScores().filter(sameStyle).sort((a, b) => b.s - a.s);
  entryDefault = S.booth ? `${S.coop ? 'ペア' : 'プレイヤー'}${todayStyle().length + 1}` : 'ななし';
  nm.value = S.booth ? '' : store.get('name', ''); nm.placeholder = S.booth ? entryDefault : 'ニックネーム';
  entry = { n: nm.value || entryDefault, s: score, m: runMode, d: S.diff, t: S.time, at: Date.now(), ...(S.coop ? { c: 1 } : {}), ...(customOn ? { x: 1 } : {}) }; lastAt = entry.at;
  const list = allScores(); list.push(entry); saveScores(list);
  const td = todayStyle(), pos = 1 + td.filter(e => e.s > entry.s).length;
  const best = score > 0 && (!before.length || score > before[0].s);
  $('#todayRank').innerHTML = `本日 <b>${pos}</b>位 ／ ${td.length}${S.coop ? '組' : '人'}中`;
  $('#newRec').textContent = S.booth ? '本日 1位！' : 'ハイスコア！';
  $('#again').querySelector('span').textContent = S.booth ? 'つぎの人へ' : 'もういっかい';
  for (const el of document.querySelectorAll('#result .rv, #emblem, #newRec')) el.classList.remove('show');
  syncPick(); modePicked = false;
  autoT = TUNING.boothResultSeconds; autoMsg = ''; resultArmed = false; $('#autoNext').textContent = ''; $('#autoBar').style.width = '100%';
  setState('result'); renderBoard();
  const sid = ++resultSeq, res = $('#result');
  const at = (ms, f) => setTimeout(() => { if (sid === resultSeq && state === 'result') f(); }, reduceMotion ? 0 : ms);
  at(60, () => { $('#rMain').classList.add('show'); Snd.select(); });
  at(350, () => countUp(sid, score, 900));
  at(1350, () => { $('#st1').classList.add('show'); Snd.tick(); });
  at(1550, () => { $('#st2').classList.add('show'); Snd.tick(); });
  at(1750, () => { $('#st3').classList.add('show'); Snd.tick(); });
  at(1950, () => { if (S.attack) { $('#st4').classList.add('show'); Snd.tick(); } });
  at(2100, () => {
    em.classList.add('show'); Snd.stamp(); res.classList.remove('shake'); void res.offsetWidth; if (!reduceMotion) res.classList.add('shake');
    if (rk === 'S' || rk === 'A') confetti(rk === 'S' ? 140 : 70);
  });
  at(2600, () => { $('#todayRank').classList.add('show'); if (best) { $('#newRec').classList.add('show'); Snd.fanfare(); confetti(120); } });
  at(2900, () => { $('#rFoot').classList.add('show'); $('#secret').classList.add('show'); $('#autoWrap').classList.add('show'); resultArmed = true; });
}
function countUp(sid, target, ms) {
  const el = $('#resScore'), t0 = performance.now(); let lastTick = 0;
  const f = now => {
    if (sid !== resultSeq) return; const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(target * e));
    if (k < 1) { if (now - lastTick > 70) { lastTick = now; Snd.tick(); } requestAnimationFrame(f); }
  };
  requestAnimationFrame(f);
}
// ブース: けっか画面のあと、自動で次の人の待機画面へ（なまえ入力中は待つ）
function updateResult(dt) {
  if (!S.booth || !resultArmed || autoT <= 0) return;
  const typing = document.activeElement === $('#nameInput');
  if (!typing) autoT -= dt;
  const msg = typing ? 'なまえを入れたら Enter で けってい' : `${Math.max(0, Math.ceil(autoT))}びょう後に、つぎの人へ`;
  if (msg !== autoMsg) { autoMsg = msg; $('#autoNext').textContent = msg; }
  $('#autoBar').style.width = (clamp(autoT / TUNING.boothResultSeconds, 0, 1) * 100) + '%';
  if (autoT <= 0) nextPlayer();
}
function nextPlayer() { if (state !== 'result') return; startNext(true); }
// ---- けっか画面で、次のプレイの むずかしさ・そうさ を えらぶ ----
let modePicked = false;
const playersValue = () => S.coop ? '2' : '1';   // 人数のボタンの値（1 = ひとり、2 = ふたりで きょうりょく）
function syncPick() {   // メニューとけっか画面の、両方のボタンを今の設定に合わせる
  for (const [name, get] of [['diff', () => S.diff], ['rdiff', () => S.diff], ['mode', () => S.mode], ['rmode', () => S.mode], ['players', playersValue], ['rplayers', playersValue]]) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(el => { el.checked = el.value === get(); });
  }
}
function startNext(lock) {
  resultSeq++; $('#nameInput').blur();
  if (modePicked && S.mode !== runMode) { modePicked = false; restartFlow(); return; }   // そうさを変えたときは、カメラ・AIの準備から
  modePicked = false; enterReady(lock);
}
function restartFlow() {
  flowId++; Music.stop(); Cam.stop(); Motion.reset(); AI.hands = []; AI.valid = 0;
  for (const p of ptrs) { p.active = false; p.trail.length = 0; }
  monsters = []; shots = []; cracks = []; fx = []; fxEl.textContent = '';
  startFlow();
}
function saveName() {
  const v = Array.from($('#nameInput').value.trim()).slice(0, 8).join(''); if (!S.booth) store.set('name', v);
  if (!entry) return; const list = allScores(), i = list.findIndex(e => e.at === entry.at && e.s === entry.s);
  if (i >= 0) { list[i].n = v || entryDefault; saveScores(list); renderBoard(); }
}
function fillBoard(ol, list, emptyText) {
  ol.textContent = '';
  if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = emptyText; ol.appendChild(li); return; }
  list.forEach((e, i) => {
    const li = document.createElement('li'); if (e.at === lastAt) li.className = 'me';
    for (const [c, t] of [['n', String(i + 1)], ['nm', String(e.n || '')], ['sc', String(e.s)]]) { const sp = document.createElement('span'); sp.className = c; sp.textContent = t; li.appendChild(sp); }
    ol.appendChild(li);
  });
}
function renderBoard() {
  const all = todayScores(), td = all.filter(sameStyle), list = S.booth ? td : allScores().filter(sameStyle).sort((a, b) => b.s - a.s);
  $('#boardTitle').textContent = (S.booth ? "TODAY'S BEST" : 'HIGH SCORE') + (S.coop ? ' ふたり' : '') + (customOn ? ' 改造' : '');
  fillBoard($('#board'), list.slice(0, 8), 'まだ記録がありません');
  $('#howAtk').hidden = !S.attack; $('#howCoop').hidden = !S.coop;
  fillBoard($('#board2'), td.slice(0, 10), 'まだ記録がありません。1番のりを目指そう！');
  const people = all.reduce((n, e) => n + (e.c ? 2 : 1), 0);   // ふたりモードの記録は2人と数える
  $('#todayCount').innerHTML = `本日の挑戦者 <b>${people}</b>人`; $('#staffCount').textContent = `今日のプレイ数：${all.length}回`;
}
function toMenu() {
  flowId++; resultSeq++; starting = false; Music.stop(); Cam.stop(); Motion.reset(); AI.hands = []; AI.valid = 0; for (const p of ptrs) { p.active = false; p.trail.length = 0; }
  monsters = []; shots = []; cracks = []; fx = []; feverT = 0; fxEl.textContent = ''; setState('menu'); renderBoard();
  const w = wakeLock; wakeLock = null; if (w) w.release().catch(() => {});
}
function pauseGame() { if (state !== 'play') return; setState('paused'); Music.pause(); }
function togglePause() {
  if (state === 'play') pauseGame();
  else if (state === 'paused') { for (const p of ptrs) { p.ox = p.x; p.oy = p.y; } setState('play'); Music.start(); }
}

// ============================================================
//  プレイ中の表示（HUD）… 値が変わったときだけ書きかえる
// ============================================================
const hud = { box: $('#hud'), score: $('#hScore'), time: $('#hTime'), timeBox: $('#hTimeBox'), ring: $('#hRing'), combo: $('#hCombo'), comboN: $('#hComboN'), mult: $('#hMult'), cbar: $('#hCbar'), fever: $('#hFever'), fbar: $('#hFbar'), sp: $('#hSp'), spBar: $('#hSpBar'), spKeys: $('#hSpKeys'), rev: $('#hRev'), revLbl: $('#hRevLbl'), rbar: $('#hRbar'), mode: $('#hMode'), hint: $('#hHint'), ghost: $('#hGhost'), ghostText: $('#hGhostText'), ghostBar: $('#hGhostBar') };
const hc = {};
function setIf(key, v, fn) { if (hc[key] !== v) { hc[key] = v; fn(v); } }
function updateHUD() {
  const on = state === 'countdown' || state === 'play' || state === 'paused' || state === 'finish';
  setIf('on', on, v => hud.box.classList.toggle('on', v)); if (!on) return;
  setIf('quiet', quietUi(), v => hud.box.classList.toggle('quiet', v));
  setIf('score', String(Math.round(shown)), v => { hud.score.textContent = v; });
  setIf('time', String(Math.max(0, Math.ceil(timeLeft))), v => { hud.time.textContent = v; });
  setIf('ring', Math.round(clamp(timeLeft / S.time, 0, 1) * 400), v => { hud.ring.style.strokeDashoffset = String(HOLD_C * (1 - v / 400)); });
  setIf('low', timeLeft <= 10 && state === 'play', v => hud.timeBox.classList.toggle('low', v));
  setIf('con', combo >= 2, v => hud.combo.classList.toggle('on', v));
  setIf('cn', combo, v => { if (v >= 2) { hud.comboN.textContent = String(v); hud.comboN.classList.remove('pop'); void hud.comboN.offsetWidth; hud.comboN.classList.add('pop'); } });
  setIf('mult', '×' + multOf(Math.max(1, combo)), v => { hud.mult.textContent = v; });
  setIf('cbar', Math.round(clamp(comboT / TUNING.comboWindow, 0, 1) * 50), v => { hud.cbar.style.width = (v * 2) + '%'; });
  setIf('fon', feverT > 0, v => hud.fever.classList.toggle('on', v));
  setIf('fbar', Math.round(clamp(feverT / TUNING.feverSeconds, 0, 1) * 50), v => { hud.fbar.style.width = (v * 2) + '%'; });
  setIf('spfull', spGauge >= spMax(), v => hud.sp.classList.toggle('ready', v));
  setIf('spbar', Math.round(clamp(spGauge / spMax(), 0, 1) * 50), v => { hud.spBar.style.width = (v * 2) + '%'; });
  setIf('spkeys', runMode !== 'ai' ? '1 2 3 キー' : S.coop ? 'ふたりで ✋✌✊' : '✋ ✌ ✊', v => { hud.spKeys.textContent = v; });
  setIf('ron', revOn(), v => hud.rev.classList.toggle('on', v));
  if (revOn()) {
    const C = TUNING.comeback, go = revActive();
    setIf('rgo', go, v => { hud.rev.classList.toggle('go', v); hud.revLbl.textContent = v ? '逆転タイム' : '逆転'; });
    setIf('rbar', Math.round((go ? rev.t / C.seconds : rev.gauge / C.gaugeMax) * 50), v => { hud.rbar.style.width = (v * 2) + '%'; });
  }
  setIf('mode', { ai: 'AIハンド', motion: 'モーション', mouse: 'マウス' }[runMode] + (runMode === 'ai' && AI.info ? `（${AI.info.split('/')[1]}）` : '') + (S.coop ? '・ふたり' : ''), v => { hud.mode.textContent = v; });
  const hint = runMode === 'mouse' ? 'マウスでモンスターにさわろう。ばくだんはさわらない！' : runMode === 'motion' ? '手を動かしてモンスターにふれよう。ばくだんはさけて！'
    : S.coop ? '人さし指を1人1本ずつ使って、ふたりでたおそう！' : '人さし指でモンスターにさわろう。ばくだんはさけて！';
  setIf('hint', hint, v => { hud.hint.textContent = v; });
  setIf('hop', state === 'play' && hintT < 6 ? 1 : 0, v => { hud.hint.style.opacity = String(v); });
  const hasGhost = S.ghost && previousGhost && previousGhost.length > 0;
  setIf('ghost-on', !!hasGhost, v => hud.ghost.classList.toggle('on', v));
  if (hasGhost) {
    const previousScore = Math.round(sampleGhost(previousGhost, elapsed).s);
    setIf('ghost-text', `${whoBefore()} ${previousScore}点 ／ いま ${score}点`, v => { hud.ghostText.textContent = v; });
    const ratio = Math.round(score / Math.max(1, score, previousScore) * 100);
    setIf('ghost-bar', ratio, v => { hud.ghostBar.style.width = `${v}%`; });
  }
}

// ============================================================
//  メニューまわり
// ============================================================
function bindRadios(name, key, cast, show = v => String(v), storageKey = key) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(el => {
    el.checked = show(S[key]) === el.value;
    el.addEventListener('change', () => { S[key] = cast(el.value); store.set(storageKey, S[key]); renderBoard(); Snd.move(); });
  });
}
bindRadios('mode', 'mode', v => v); bindRadios('diff', 'diff', v => v); bindRadios('time', 'time', v => parseInt(v, 10));
bindRadios('booth', 'booth', v => v === '1', v => v ? '1' : '0'); bindRadios('view', 'view', v => v);
bindRadios('attack', 'attack', v => v === '1', v => v ? '1' : '0');
bindRadios('boss', 'boss', v => v === '1', v => v ? '1' : '0');
bindRadios('ghost', 'ghost', v => v === '1', v => v ? '1' : '0', 'ghostEnabled');
bindRadios('players', 'coop', v => v === '2', v => v ? '2' : '1');
$('#embedNote').hidden = !embedded;
function goFull(on) {
  try {
    if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) { const p = document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
    else if (!on && document.fullscreenElement) { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); }
  } catch (e) { /* 全画面にできない環境 */ }
}
// ブース: 展示中に画面が暗くならないようにする（対応ブラウザのみ）
async function keepAwake() {
  if (!S.booth || wakeLock || !('wakeLock' in navigator) || document.hidden) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (e) { wakeLock = null; }
}
$('#play').addEventListener('click', () => { if (S.booth) goFull(true); startFlow(); });
$('#skipAI').addEventListener('click', () => { if (skipResolve) skipResolve(); });
$('#cancelLoad').addEventListener('click', toMenu);
$('#goNow').addEventListener('click', () => { if (state === 'ready') { readyLock = 0; beginGame(); } });
$('#resume').addEventListener('click', togglePause);
$('#quit').addEventListener('click', toMenu);
$('#again').addEventListener('click', () => { Snd.init(); if (state === 'result') startNext(S.booth); });
document.querySelectorAll('input[name="rdiff"], input[name="rmode"], input[name="rplayers"]').forEach(el => el.addEventListener('change', () => {
  if (el.name === 'rplayers') { S.coop = el.value === '2'; store.set('coop', S.coop); }
  else { const key = el.name === 'rdiff' ? 'diff' : 'mode'; S[key] = el.value; store.set(key, el.value); if (key === 'mode') modePicked = true; }
  syncPick(); renderBoard(); Snd.move(); autoT = Math.max(autoT, 8);   // えらんでいる間は、自動で次へ進まない
}));
$('#toMenu').addEventListener('click', toMenu);
$('#nameInput').addEventListener('input', () => { saveName(); autoT = Math.max(autoT, 8); });
$('#nameInput').addEventListener('blur', () => { if (state === 'result') autoT = Math.max(autoT, 5); });
$('#bPause').addEventListener('click', togglePause);
function syncBar() { $('#bSound').setAttribute('aria-pressed', String(S.sound)); $('#bSound').textContent = S.sound ? 'おと ON' : 'おと OFF'; $('#bEye').setAttribute('aria-pressed', String(S.eye)); }
$('#bSound').addEventListener('click', () => { S.sound = !S.sound; store.set('sound', S.sound); Snd.init(); syncBar(); });
$('#bEye').addEventListener('click', () => { S.eye = !S.eye; syncBar(); });
$('#bFull').addEventListener('click', () => goFull(!document.fullscreenElement));
let resetArm = 0;
$('#resetToday').addEventListener('click', () => {
  const b = $('#resetToday');
  if (Date.now() - resetArm > 4000) { resetArm = Date.now(); b.textContent = 'もう一度おすと消えます'; setTimeout(() => { if (Date.now() - resetArm >= 3900) b.textContent = '今日の記録をリセット'; }, 4000); return; }
  resetArm = 0; const k = dayKey(Date.now()); store.set('scores', allScores().filter(e => dayKey(e.at) !== k)); for (const g of GHOST_KEYS) store.set(g, null);
  previousGhost = null; ghostSamples = []; ghostNextSample = 0;
  b.textContent = '今日の記録をリセット'; lastAt = 0; renderBoard(); toast('今日の記録をリセットしました', 3000);
});
document.querySelectorAll('.card, .chip, .gbtn').forEach(el => el.addEventListener('pointerenter', () => { if (Snd.ctx) Snd.move(); }));
syncBar();
window.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') { if (e.key === 'Enter') e.target.blur(); return; }
  const k = e.code;
  if (editorOpen()) { if (k === 'Escape' || k === 'KeyS') openEditor(false); return; }   // モンスター改造を開いている間は、ゲームのキーを使わない
  if (k === 'KeyP') togglePause();
  else if (k === 'Escape' || k === 'KeyS') { if (state === 'play') pauseGame(); else if (state !== 'menu') toMenu(); }
  else if (k === 'KeyN') nextPlayer();
  else if (k === 'KeyF') goFull(!document.fullscreenElement);
  else if (k === 'KeyM') { S.sound = !S.sound; store.set('sound', S.sound); Snd.init(); syncBar(); toast(S.sound ? '音 ON' : '音 OFF', 1500); }
  else if (k === 'KeyE') { S.eye = !S.eye; syncBar(); }
  else if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') {   // 必殺技をキーで出す（マウス・モーションで遊ぶとき用。ふたりモードで Shift をおすと合体技）
    const p = ptrs.find(q => q.active), x = p ? p.x : W / 2, y = p ? p.y : H / 2;
    const q = ptrs[1].active && ptrs[1] !== p ? ptrs[1] : { x: x < W / 2 ? x + W / 3 : x - W / 3, y };   // あいぼうの手がなければ、となりに置く
    fireSpecial({ Digit1: 'open', Digit2: 'peace', Digit3: 'fist' }[k], x, y, e.shiftKey ? { x: q.x, y: q.y } : null);
  }
  else if ((k === 'Space' || k === 'Enter') && state === 'menu' && document.activeElement === document.body) { e.preventDefault(); if (S.booth) goFull(true); startFlow(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pauseGame(); if (!document.hidden && state !== 'menu') keepAwake(); });

// モンスターずかん（ゲーム内と同じ絵を小さく描く）
function drawIcon(type, canvas) {
  const dpr = 2, px = canvas.dataset.size | 0 || 48; canvas.width = px * dpr; canvas.height = px * dpr; const c = canvas.getContext('2d'), main = ctx; ctx = c;
  try {
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.translate(px / 2, px / 2 + 1);
    if (type === 'boss') { const R = TUNING.boss.radius, k = px * .42 / R; c.translate(0, px * .06); c.scale(k, k); drawKing(R); return; }
    const T = MON_BASE[type];   // ずかんの絵は、改造した大きさに関係なく 同じ大きさで描く
    const k = SPR[type] ? (px * .92) / ((T.spr || 2.6) * T.r) : (px / 48) * ({ golem: .36, bat: .44, bomb: .5 }[type] || .58);
    c.scale(k, k); drawBody({ type, r: T.r, hr: T.hr || T.r, hp: T.hp, maxHp: T.hp, vx: 0, vy: 0, age: 1, ph: 0, flash: 0 }, .3);
  } finally { ctx = main; }
}
function drawDexIcons() { document.querySelectorAll('canvas[data-mon]').forEach(c => drawIcon(c.dataset.mon, c)); }
function renderDexText() { document.querySelectorAll('[data-desc]').forEach(el => { el.textContent = describe(MON[el.dataset.desc]); }); }

// ============================================================
//  モンスター改造（メニュー）… 体力・点数・大きさ・速さ・出やすさ の数字を変えると、ゲームが変わる
// ============================================================
const fmtCustom = (f, v) => f === 'freq' && v === 0 ? '出ない' : (f === 'size' || f === 'speed' || f === 'freq') ? `${v}%` : String(v);
function buildEditor() {
  const grid = $('#meGrid'), el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  grid.textContent = '';
  grid.appendChild(el('span', 'me-h'));
  for (const F of Object.values(CUSTOM_FIELDS)) { const h = el('span', 'me-h', F.label); h.appendChild(el('small', '', F.sub)); grid.appendChild(h); }
  for (const { type, fields } of CUSTOM_ROWS) {
    const label = type === 'boss' ? 'スライムキング' : MON[type].name, name = el('div', 'me-name'), cvs = el('canvas');
    cvs.dataset.mon = type; cvs.dataset.size = '34'; name.append(cvs, el('b', '', label)); grid.appendChild(name);
    for (const [f, F] of Object.entries(CUSTOM_FIELDS)) {
      if (!fields.includes(f)) { grid.appendChild(el('span', 'me-na', '—')); continue; }
      const st = el('div', 'stp'), minus = el('button', '', '−'), plus = el('button', '', '+');
      st.dataset.t = type; st.dataset.f = f;
      for (const [b, d, verb] of [[minus, -1, 'へらす'], [plus, 1, 'ふやす']]) { b.type = 'button'; b.dataset.d = String(d); b.setAttribute('aria-label', `${label}の${F.label}を${verb}`); }
      st.append(minus, el('output'), plus); grid.appendChild(st);
    }
  }
  drawDexIcons(); updateEditor();
}
function updateEditor() {
  document.querySelectorAll('#meGrid .stp').forEach(st => {
    const { t, f } = st.dataset, v = monCfg[t][f];
    st.querySelector('output').textContent = fmtCustom(f, v);
    st.classList.toggle('changed', v !== MON_DEFAULTS[t][f]);   // 元の数字から変えたところは、金色にする
    st.querySelector('[data-d="-1"]').disabled = stepCustom(t, f, v, -1) === v;
    st.querySelector('[data-d="1"]').disabled = stepCustom(t, f, v, 1) === v;
  });
  $('#modBadge').hidden = !customOn;
}
function saveMonCfg() { store.set('monsters', monCfg); applyMonCfg(); updateEditor(); renderDexText(); renderBoard(); }
function openEditor(on) { $('#monEdit').hidden = !on; if (on) { updateEditor(); $('#meClose').focus(); } else $('#openMod').focus(); }
$('#meGrid').addEventListener('click', e => {
  const btn = e.target.closest('button[data-d]'); if (!btn) return;
  const { t, f } = btn.closest('.stp').dataset;
  monCfg[t][f] = stepCustom(t, f, monCfg[t][f], Number(btn.dataset.d));
  saveMonCfg(); Snd.init(); Snd.move();
});
$('#openMod').addEventListener('click', () => { Snd.init(); Snd.select(); openEditor(true); });
$('#meClose').addEventListener('click', () => { Snd.select(); openEditor(false); });
$('#meReset').addEventListener('click', () => { monCfg = sanitizeCustom(null, MON_DEFAULTS); saveMonCfg(); Snd.select(); });
const editorOpen = () => !$('#monEdit').hidden;

(() => {
  for (const [id, size] of [['#dex2', 46]]) {
    const ul = $(id);
    for (const type of ['slime', 'ghost', 'bat', 'golem', 'star', 'bomb']) {
      const li = document.createElement('li'), cvs = document.createElement('canvas'), d = document.createElement('div'), b = document.createElement('b'), s = document.createElement('small');
      cvs.dataset.mon = type; cvs.dataset.size = String(size); b.textContent = MON[type].name; s.dataset.desc = type; d.append(b, s); li.append(cvs, d); ul.appendChild(li);
    }
  }
  buildEditor(); renderDexText(); renderBoard();
})();

// ============================================================
//  えがく
// ============================================================
function eyes(dx, y, er, m) {
  const l = Math.hypot(m.vx, m.vy) || 1, ox = m.vx / l * er * .3, oy = m.vy / l * er * .3;
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * dx, y, er, 0, TAU); ctx.fill();
    ctx.fillStyle = '#10142a'; ctx.beginPath(); ctx.arc(s * dx + ox, y + oy, er * .55, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * dx + ox - er * .15, y + oy - er * .2, er * .17, 0, TAU); ctx.fill();
  }
}
function sparkle(x, y, s, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath();
  ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.moveTo(x - s * .6, y - s * .6); ctx.lineTo(x + s * .6, y + s * .6); ctx.moveTo(x + s * .6, y - s * .6); ctx.lineTo(x - s * .6, y + s * .6); ctx.stroke();
}
function drawSlime(m) {
  const r = m.r, st = clamp(m.vy / 1400, -.22, .22); ctx.scale(1 - st * .8, 1 + st);
  const g = ctx.createLinearGradient(0, -r, 0, r); g.addColorStop(0, '#a6ffd0'); g.addColorStop(1, '#14c46a');
  ctx.fillStyle = g; ctx.strokeStyle = '#07663a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-r, r * .55);
  ctx.bezierCurveTo(-r * 1.05, -r * .2, -r * .6, -r, 0, -r); ctx.bezierCurveTo(r * .6, -r, r * 1.05, -r * .2, r, r * .55);
  ctx.quadraticCurveTo(r * .9, r * .95, 0, r * .95); ctx.quadraticCurveTo(-r * .9, r * .95, -r, r * .55); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(-r * .4, -r * .52, r * .2, r * .12, -.6, 0, TAU); ctx.fill();
  eyes(r * .3, -r * .08, r * .2, m);
  ctx.strokeStyle = '#07663a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, r * .22, r * .16, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
}
function drawGhost(m, t) {
  const r = m.r, w = Math.sin(t * 6 + m.ph) * r * .08;
  ctx.fillStyle = 'rgba(236,246,255,.95)'; ctx.strokeStyle = 'rgba(110,160,225,.95)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-r, r * .7); ctx.lineTo(-r, -r * .1); ctx.arc(0, -r * .1, r, Math.PI, 0); ctx.lineTo(r, r * .7);
  const n = 3, bw = 2 * r / n; for (let i = 0; i < n; i++) ctx.quadraticCurveTo(r - bw * (i + .5), r * .7 + (i % 2 ? -1 : 1) * r * .34 + w, r - bw * (i + 1), r * .7);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#26305a'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * r * .34, -r * .15, r * .12, r * .18, 0, 0, TAU); ctx.fill(); }
  ctx.beginPath(); ctx.ellipse(0, r * .22, r * .12, r * .16, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,120,170,.35)'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * r * .55, r * .08, r * .13, r * .08, 0, 0, TAU); ctx.fill(); }
}
function drawBat(m, t) {
  const r = m.r, flap = Math.sin(t * 20 + m.ph);
  ctx.fillStyle = '#4a2a8c'; ctx.strokeStyle = '#1d0f45'; ctx.lineWidth = 2.5;
  for (const s of [-1, 1]) {
    ctx.save(); ctx.scale(s, 1); ctx.rotate(flap * .5); ctx.beginPath(); ctx.moveTo(r * .3, -r * .1);
    ctx.quadraticCurveTo(r * 1.3, -r * 1.3, r * 2, -r * .5); ctx.quadraticCurveTo(r * 1.6, -r * .2, r * 1.7, r * .4); ctx.quadraticCurveTo(r * 1.2, r * .1, r, r * .55); ctx.quadraticCurveTo(r * .7, r * .15, r * .3, r * .4);
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  ctx.fillStyle = '#6a3fc7'; ctx.beginPath(); ctx.arc(0, 0, r * .62, 0, TAU); ctx.fill(); ctx.stroke();
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * r * .45, -r * .35); ctx.lineTo(s * r * .38, -r * .98); ctx.lineTo(s * r * .06, -r * .55); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = '#ff5a6e'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * r * .24, -r * .05, r * .13, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#fff'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * r * .2, r * .22); ctx.lineTo(s * r * .1, r * .42); ctx.lineTo(s * r * .02, r * .22); ctx.closePath(); ctx.fill(); }
}
function drawGolem(m) {
  const r = m.r; ctx.fillStyle = '#8f9bb0'; ctx.strokeStyle = '#3b4559'; ctx.lineWidth = 4;
  rrPath(-r * 1.28, -r * .1, r * .55, r * .9, 10); ctx.fill(); ctx.stroke(); rrPath(r * .73, -r * .1, r * .55, r * .9, 10); ctx.fill(); ctx.stroke();
  const g = ctx.createLinearGradient(0, -r, 0, r); g.addColorStop(0, '#c3cbd9'); g.addColorStop(1, '#7b879c');
  ctx.fillStyle = g; rrPath(-r * .95, -r * .95, r * 1.9, r * 1.85, r * .35); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#58b36a'; ctx.beginPath(); ctx.ellipse(-r * .45, -r * .9, r * .4, r * .16, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffd24d'; rrPath(-r * .55, -r * .35, r * .35, r * .22, 4); ctx.fill(); rrPath(r * .2, -r * .35, r * .35, r * .22, 4); ctx.fill();
  ctx.fillStyle = '#2e3648'; rrPath(-r * .35, r * .2, r * .7, r * .18, 4); ctx.fill();
  const dmg = m.maxHp - m.hp; ctx.strokeStyle = '#2e3648'; ctx.lineWidth = 3;
  if (dmg >= 1) { ctx.beginPath(); ctx.moveTo(-r * .1, -r * .95); ctx.lineTo(-r * .25, -r * .55); ctx.lineTo(0, -r * .3); ctx.stroke(); }
  if (dmg >= 2) { ctx.beginPath(); ctx.moveTo(r * .5, r * .9); ctx.lineTo(r * .3, r * .5); ctx.lineTo(r * .6, r * .2); ctx.stroke(); }
}
function drawBombBody(m, t) {
  const r = m.r;
  const g = ctx.createRadialGradient(-r * .3, -r * .35, r * .1, 0, 0, r); g.addColorStop(0, '#5a5f73'); g.addColorStop(1, '#10121c');
  ctx.fillStyle = g; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, r * .1, r * .9, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3b3f52'; rrPath(-r * .28, -r * .98, r * .56, r * .3, 4); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#c9a46a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -r * .98); ctx.quadraticCurveTo(r * .35, -r * 1.3, r * .6, -r * 1.15); ctx.stroke();
  sparkle(r * .6, -r * 1.15, 7 + Math.sin(t * 30) * 2, '#ffd24d');
  ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 3.5;
  for (const s of [-1, 1]) { const ex = s * r * .32; ctx.beginPath(); ctx.moveTo(ex - 6, -6); ctx.lineTo(ex + 6, 6); ctx.moveTo(ex + 6, -6); ctx.lineTo(ex - 6, 6); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(0, r * .66, r * .2, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
}
function drawStar(m, t) {
  const r = m.r; ctx.rotate(Math.sin(t * 3 + m.ph) * .25);
  const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 1.7); g.addColorStop(0, 'rgba(255,230,120,.6)'); g.addColorStop(1, 'rgba(255,200,60,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 1.7, 0, TAU); ctx.fill();
  ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * .48 : r; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad); } ctx.closePath();
  ctx.fillStyle = '#ffd24d'; ctx.strokeStyle = '#b57a00'; ctx.lineWidth = 3; ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#7a4f00'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * r * .2, -r * .02, r * .07, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = '#7a4f00'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, r * .1, r * .14, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
}
// 画像（assets/◯◯.png）があるときは、こちらで描く。動きはプログラムでつける
function drawSprite(m, t, img) {
  const T = MON[m.type], s = (T.spr || 2.6) * m.r, ar = img.width / img.height, w = ar >= 1 ? s : s * ar, h = ar >= 1 ? s / ar : s;
  ctx.save();
  if (m.type === 'slime') { const st = clamp(m.vy / 1400, -.22, .22); ctx.scale(1 - st * .8, 1 + st); }
  else if (m.type === 'ghost') ctx.rotate(Math.sin(t * 3 + m.ph) * .12);
  else if (m.type === 'bat') ctx.scale(1, 1 + Math.sin(t * 20 + m.ph) * .12);
  else if (m.type === 'star') ctx.rotate(Math.sin(t * 3 + m.ph) * .3);
  else if (m.type === 'bomb') { const k = 1 + Math.sin(t * 8 + m.ph) * .05; ctx.scale(k, k); }
  else if (m.type === 'golem' && m.flash > 0) ctx.translate(rnd(-3, 3), 0);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}
function drawBody(m, t) {
  if (m.type === 'bomb') {   // ばくだんは、画像でも「危ない」の赤い輪を必ず出す（逆転タイム中は金色の輪）
    const pulse = .5 + .5 * Math.sin(t * 8 + m.ph), gold = revActive();
    if (gold) { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, m.r * 1.8); g.addColorStop(0, 'rgba(255,230,107,.75)'); g.addColorStop(1, 'rgba(255,210,63,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, m.r * 1.8, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = gold ? `rgba(255,214,63,${.6 + .4 * pulse})` : `rgba(255,77,94,${.35 + .4 * pulse})`; ctx.lineWidth = 4; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -t * 30;
    ctx.beginPath(); ctx.arc(0, 0, m.r + 10 + pulse * 3, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  const img = SPR[m.type];
  if (img) drawSprite(m, t, img);
  else switch (m.type) { case 'slime': drawSlime(m); break; case 'ghost': drawGhost(m, t); break; case 'bat': drawBat(m, t); break; case 'golem': drawGolem(m); break; case 'bomb': drawBombBody(m, t); break; case 'star': drawStar(m, t); break; }
  if (m.maxHp > 1 && m.type !== 'bomb') {   // 体力が2以上の敵は、頭の上に のこりの体力を出す（多いときはバー）
    if (m.maxHp <= 6) for (let i = 0; i < m.maxHp; i++) { ctx.fillStyle = i < m.hp ? '#ffd24d' : 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc((i - (m.maxHp - 1) / 2) * 16, -m.r * 1.25, 5, 0, TAU); ctx.fill(); }
    else { const w = 64, y = -m.r * 1.25 - 4; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-w / 2, y, w, 8); ctx.fillStyle = '#ffd24d'; ctx.fillRect(-w / 2, y, w * clamp(m.hp / m.maxHp, 0, 1), 8); }
  }
}
function drawMonster(m, t, alpha = 1) {
  const sp = m.age < .2 ? easeOutBack(m.age / .2) : 1;   // 出てくるとき、ポンとふくらむ
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(m.x, m.y); if (sp !== 1) ctx.scale(sp, sp); drawBody(m, t);
  if (m.flash > 0) { ctx.globalAlpha = alpha * clamp(m.flash / .15, 0, 1) * .65; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, m.r * .95, 0, TAU); ctx.fill(); }
  ctx.restore();
}
function drawGhostRace() {
  if (!S.ghost || !previousGhost || !previousGhost.length) return;
  const sample = sampleGhost(previousGhost, elapsed);
  if (!sample) return;
  ctx.save();
  ctx.globalAlpha = TUNING.ghost.opacity;
  ctx.strokeStyle = TUNING.ghost.color;
  ctx.fillStyle = TUNING.ghost.color;
  ctx.lineWidth = 3;
  ctx.shadowColor = TUNING.ghost.color;
  ctx.shadowBlur = TUNING.ghost.radius;
  for (const point of sample.p) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, TUNING.ghost.radius, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, TUNING.ghost.radius / 4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
// スライムキングの体（assets/boss.png があれば、その画像）。ボス戦と、モンスター改造の絵で使う
function drawKing(radius, vx = 0, vy = 0) {
  if (SPR.boss) { ctx.drawImage(SPR.boss, -radius, -radius, radius * 2, radius * 2); return; }
  drawSlime({ r: radius, vx, vy });
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = '#8b5a00';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-radius * .48, -radius * .76);
  ctx.lineTo(-radius * .3, -radius * 1.08);
  ctx.lineTo(0, -radius * .83);
  ctx.lineTo(radius * .3, -radius * 1.08);
  ctx.lineTo(radius * .48, -radius * .76);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
function drawBoss() {
  if (!boss || boss.hp <= 0) return;
  const radius = TUNING.boss.radius;
  ctx.save();
  ctx.globalAlpha = .92;
  ctx.translate(boss.x, boss.y);
  {   // ダッシュの向きに少し伸びて、ふだんはぽよんと弾む
    const dash = clamp((boss.speed - TUNING.boss.moveSpeed) / Math.max(1, TUNING.boss.dashSpeed - TUNING.boss.moveSpeed), 0, 1);
    const bob = Math.sin(boss.age * 9) * .05, ang = Math.atan2(boss.vy, boss.vx);
    ctx.rotate(ang); ctx.scale(1 + dash * .22, 1 - dash * .14); ctx.rotate(-ang);
    ctx.scale(1 - bob, 1 + bob);
    if (boss.hitCooldown > 0) ctx.translate((Math.random() - .5) * 8, 0);   // 斬られた瞬間ぶるっとふるえる
  }
  drawKing(radius, boss.vx, boss.vy);
  ctx.restore();

  const barWidth = radius * 2;
  const barHeight = TUNING.boss.barHeight;
  const barX = boss.x - barWidth / 2;
  const barY = boss.y - radius - TUNING.boss.barOffset - barHeight;
  ctx.fillStyle = 'rgba(0,0,0,.8)';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.fillStyle = TUNING.boss.color;
  ctx.fillRect(barX, barY, barWidth * clamp(boss.hp / boss.maxHp, 0, 1), barHeight);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.strokeRect(barX, barY, barWidth, barHeight);
  txt('スライムキング', boss.x, barY - TUNING.boss.barOffset / 3, 16, '#ffffff', 'center', 800, FB, { w: 4, c: 'rgba(6,8,24,.9)' });
}
// 必殺ゲージが満タンで手の形を見せているとき、手のまわりに「ため」の輪を出す。
// ふたりモードで2人が同じ形をしているときは、手と手を いなずまでつなぐ（合体技の「ため」）
function drawGestureCharge(t) {
  const C = TUNING.special;
  if (runMode !== 'ai' || spGauge < spMax()) return;
  const live = gestureTrs.map((tr, k) => ({ tr, k })).filter(o => o.tr.kind && !o.tr.locked);
  const pair = S.coop && live.length === 2 && live[0].tr.kind === live[1].tr.kind;
  if (pair) {
    const [a, b] = live.map(o => o.tr), k = clamp(Math.min(a.hold, b.hold) / C.holdSeconds, 0, 1);
    drawLink(a.x, a.y, b.x, b.y, k, t);
    txt(`合体！ ${GESTURE_ICONS[a.kind].repeat(2)}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 24, 22, '#ffe66b', 'center', 900, FB, { w: 5, c: 'rgba(6,8,24,.85)' });
  }
  for (const { tr, k } of live) {
    const p = clamp(tr.hold / C.holdSeconds, 0, 1), x = tr.x, y = tr.y;
    ctx.save(); ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.strokeStyle = S.coop ? ptrs[k].color + '66' : 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(x, y, 58, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x, y, 58, -Math.PI / 2, -Math.PI / 2 + TAU * p); ctx.stroke();
    let label = GESTURE_ICONS[tr.kind] + ' ' + GESTURE_NAMES[tr.kind];
    if (S.coop && !pair && p >= 1) {   // あいぼうを待っている間: 外がわの輪がへっていき、なくなるとひとりで技が出る
      const w = clamp(1 - (tr.hold - C.holdSeconds) / Math.max(.01, TUNING.coop.waitSeconds), 0, 1);
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, 70, -Math.PI / 2, -Math.PI / 2 + TAU * w); ctx.stroke();
      label = `あいぼうも ${GESTURE_ICONS[tr.kind]}！`;
    }
    txt(label, x, y - 82, 18, '#ffe66b', 'center', 800, FB, { w: 4, c: 'rgba(6,8,24,.85)' });
    ctx.restore();
  }
}
function drawLink(ax, ay, bx, by, k, t) {   // 2つの手をつなぐ いなずま（k: ため具合 0〜1）
  const n = 12, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [w, col, a] of [[12, '#ffd23f', .35], [4, '#ffffff', 1]]) {
    ctx.globalAlpha = (.3 + .7 * k) * a; ctx.strokeStyle = col; ctx.lineWidth = w * (.5 + .5 * k); ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const f = i / n, j = i === 0 || i === n ? 0 : Math.sin(t * 37 + i * 2.3) * Math.cos(t * 23 + i) * 16 * (.4 + k);
      ctx[i ? 'lineTo' : 'moveTo'](ax + dx * f + nx * j, ay + dy * f + ny * j);
    }
    ctx.stroke();
  }
  ctx.restore();
}
function drawHands() {
  ctx.save(); ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const hh of AI.hands) {
    const pts = hh.pts; ctx.globalAlpha = hh.ok ? 1 : .35;
    ctx.strokeStyle = 'rgba(46,242,255,.9)'; ctx.beginPath(); for (const [a, b] of HAND_LINKS) { ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); } ctx.stroke();
    for (let i = 0; i < pts.length; i++) { ctx.fillStyle = i === 8 ? '#ff2e88' : '#fff'; ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, i === 8 ? 7 : 3.5, 0, TAU); ctx.fill(); }
    const shape = hh.ok ? GESTURE_NAMES[classifyHand(hh.raw)] : '';   // AIの目: 見分けた手の形も出す
    txt(hh.ok ? '手 21点' + (shape ? `・${shape}` : '') : 'とおい手（むし）', pts[0].x, pts[0].y + 26, 13, '#2ef2ff', 'center', 800, FB, { w: 4, c: 'rgba(6,8,24,.8)' }); ctx.globalAlpha = 1;
  }
  ctx.restore();
}
function drawTrails(t) {
  for (const p of ptrs) {
    if (!p.active) continue;
    const col = feverT > 0 ? '#ffd23f' : p.color, pts = p.trail.filter(q => t - q.t < .28);
    if (pts.length > 1) {
      ctx.lineCap = 'round'; ctx.strokeStyle = col;
      for (let i = 1; i < pts.length; i++) { const k = i / pts.length; ctx.globalAlpha = .15 + .7 * k; ctx.lineWidth = 3 + 12 * k; ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 28); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.35, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, TAU); ctx.fill();
  }
}
function drawFx() {
  for (const f of fx) {
    const k = f.life / f.max;
    if (f.kind === 'p') { ctx.globalAlpha = clamp(k * 1.4, 0, 1); ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, f.size * (.4 + .6 * k), 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    else if (f.kind === 'r') { ctx.globalAlpha = k * .8; ctx.strokeStyle = f.color; ctx.lineWidth = 4 * k + 1; ctx.beginPath(); ctx.arc(f.x, f.y, f.rmax * (1 - k) + 8, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
    else if (f.kind === 's') { ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang); ctx.globalAlpha = k; ctx.strokeStyle = '#fff'; ctx.lineWidth = 8 * k + 1; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-f.len * (1.2 - k * .2), 0); ctx.lineTo(f.len * (1.2 - k * .2), 0); ctx.stroke(); ctx.restore(); }
    else if (f.kind === 't') { ctx.globalAlpha = clamp(k * 2, 0, 1); txt(f.text, f.x, f.y, f.size, f.color, 'center', f.font === FX ? 400 : 900, f.font, { w: 6, c: 'rgba(6,8,24,.9)' }); ctx.globalAlpha = 1; }
    else if (f.kind === 'c') { ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.scale(Math.cos(f.rot * 1.7), 1); ctx.globalAlpha = clamp(k * 2, 0, 1); ctx.fillStyle = f.color; ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h); ctx.restore(); }
  }
}
// 火の玉（assets/fireball.png があれば、その画像を使う）
function drawFireball(x, y, r, t, fromX, fromY) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (fromX !== undefined) {   // 尾: 来た方向にのびる
    const dx = fromX - x, dy = fromY - y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    for (let i = 5; i >= 1; i--) { const d = r * .5 * i; ctx.globalAlpha = .1 * (6 - i); ctx.fillStyle = i > 2 ? '#ff4a00' : '#ff9a00'; ctx.beginPath(); ctx.arc(x + ux * d, y + uy * d, Math.max(1, r * (1 - i * .14)), 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  const img = SPR.fireball;
  if (img) { ctx.globalCompositeOperation = 'source-over'; const s = r * 2.6; ctx.translate(x, y); ctx.rotate(t * 6); ctx.drawImage(img, -s / 2, -s / 2, s, s); ctx.restore(); return; }
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.4);
  g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(.28, 'rgba(255,220,90,1)'); g.addColorStop(.62, 'rgba(255,110,20,.95)'); g.addColorStop(1, 'rgba(255,30,0,0)');
  ctx.fillStyle = g; ctx.beginPath();
  for (let i = 0; i <= 18; i++) { const a = i / 18 * TAU, rr = r * 1.4 * (1 + .12 * Math.sin(t * 24 + i * 1.9)); if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawShot(s, t, alpha) {
  ctx.save(); ctx.globalAlpha = alpha;
  if (s.st === 'charge') {   // 投げる前: 頭の上に「!」と、ためている火
    const k = clamp(s.t / TUNING.attacks.windup, 0, 1), top = s.y - 12;
    drawFireball(s.x, top, 5 + 9 * k, t);
    if (Math.sin(t * 20) > -.3) txt('!', s.x, top - 22, 40, '#ff3b5c', 'center', 400, FX, { w: 6, c: 'rgba(6,8,24,.9)' });
  } else if (s.st === 'fly') {   // ねらわれている場所に赤い照準
    const k = clamp(s.t / (TUNING.attacks.flyTime[S.diff] || 1.8), 0, 1);
    const rr = 84 - 26 * k, blink = .7 + .3 * Math.sin(t * 16);
    ctx.globalAlpha = alpha * (.12 + .18 * k); ctx.fillStyle = '#ff3b5c'; ctx.beginPath(); ctx.arc(s.tx, s.ty, rr, 0, TAU); ctx.fill();   // 近づくほど赤くなる
    ctx.globalAlpha = alpha * blink; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(6,8,24,.75)'; ctx.setLineDash([12, 8]); ctx.lineDashOffset = -t * 40;
    ctx.beginPath(); ctx.arc(s.tx, s.ty, rr, 0, TAU); ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = '#ff3b5c'; ctx.beginPath(); ctx.arc(s.tx, s.ty, rr, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 4; ctx.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(s.tx + dx * 18, s.ty + dy * 18); ctx.lineTo(s.tx + dx * 38, s.ty + dy * 38); } ctx.stroke();
    ctx.globalAlpha = alpha;
    drawFireball(s.x, s.y, s.r, t, s.ox, s.oy);
  } else drawFireball(s.x, s.y, s.r, t);
  ctx.restore();
}
function drawCracks() {
  for (const c of cracks) {
    const a = clamp(c.life / c.max * 1.6, 0, 1);
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.globalAlpha = a * .35; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(c.x, c.y, 26, 0, TAU); ctx.fill();
    for (const [w, col] of [[5, 'rgba(0,0,0,.55)'], [2, '#ffffff']]) {
      ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      for (const ray of c.rays) { ctx.moveTo(ray[0][0], ray[0][1]); for (let i = 1; i < ray.length; i++) ctx.lineTo(ray[i][0], ray[i][1]); }
      for (const g of c.rings) { ctx.moveTo(c.x + Math.cos(g.a0) * g.r, c.y + Math.sin(g.a0) * g.r); ctx.arc(c.x, c.y, g.r, g.a0, g.a0 + g.span); }
      ctx.stroke();
    }
    ctx.restore();
  }
}
// 「ぼかし」用: 映像をいったん小さく(64×36)して、引きのばす → 顔がわからなくなる
const blurCv = document.createElement('canvas'); blurCv.width = 64; blurCv.height = 36; const blurC = blurCv.getContext('2d');
function drawArena(t) {   // カメラ映像を出さないときの背景: 夜空と、奥から流れてくる床のグリッド
  ctx.drawImage(skyLayer, 0, 0);
  for (const s of STARS) { ctx.globalAlpha = .35 + .35 * Math.sin(t * 2 + s.p); ctx.fillStyle = '#cfe9ff'; ctx.fillRect(s.x, s.y, s.s, s.s); }
  ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(46,242,255,.35)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) { const z = (i + gridPhase) / 14, y = HZ + z * z * (H - HZ); ctx.globalAlpha = .2 + .8 * z; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.globalAlpha = .55; for (let i = -16; i <= 16; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 18, HZ); ctx.lineTo(W / 2 + i * 150, H); ctx.stroke(); }
  ctx.globalAlpha = 1;
}
function drawBackground(t) {
  if (Cam.ready && state !== 'menu' && state !== 'loading' && S.view !== 'hide') {
    if (S.view === 'blur') {
      const k = 64 / W; blurC.setTransform(-1, 0, 0, 1, 64, 0); blurC.drawImage(Cam.video, Cam.cv.ox * k, Cam.cv.oy * k, Cam.cv.dw * k, Cam.cv.dh * k);
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(blurCv, 0, 0, W, H); ctx.restore();
    } else { ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(Cam.video, Cam.cv.ox, Cam.cv.oy, Cam.cv.dw, Cam.cv.dh); ctx.restore(); }
    ctx.fillStyle = state === 'result' ? 'rgba(4,6,22,.72)' : 'rgba(4,6,22,.46)'; ctx.fillRect(0, 0, W, H);
  } else { drawArena(t); if (state === 'result') { ctx.fillStyle = 'rgba(4,6,22,.45)'; ctx.fillRect(0, 0, W, H); } }
  ctx.drawImage(vigLayer, 0, 0);
  if (feverT > 0) { ctx.fillStyle = `rgba(255,200,61,${.1 + .06 * Math.sin(t * 6)})`; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = `hsl(${(t * 240) % 360},100%,62%)`; ctx.lineWidth = 9; ctx.strokeRect(4, 4, W - 8, H - 8); }
  if (barrierT > 0 && state === 'play') {   // ✌バリア中は、画面のふちが水色に光る
    const a = barrierT < 1.5 ? (Math.sin(t * 20) > 0 ? .9 : .3) : .55 + .25 * Math.sin(t * 6);   // 終わりぎわは点滅
    ctx.strokeStyle = `rgba(125,249,255,${a})`; ctx.lineWidth = 10; ctx.strokeRect(24, 24, W - 48, H - 48);
  }
  if (revActive() && state === 'play') { ctx.strokeStyle = `rgba(255,214,63,${.6 + .3 * Math.sin(t * 10)})`; ctx.lineWidth = 6; ctx.strokeRect(14, 14, W - 28, H - 28); }
  if (flashRed > 0) { ctx.fillStyle = `rgba(255,40,60,${flashRed * .4})`; ctx.fillRect(0, 0, W, H); }
}
// メニューや待機画面のうしろで、ゆっくりただよう飾りのモンスター
function initDeco() {
  deco = []; const types = ['slime', 'ghost', 'bat', 'slime', 'star', 'golem', 'ghost'];
  types.forEach((type, i) => deco.push({ type, r: MON[type].r, hr: MON[type].r, hp: MON[type].hp, maxHp: MON[type].hp, x: rnd(40, W - 40), y: rnd(60, H - 60), vx: rnd(-26, 26), vy: rnd(-16, 16), age: 1, ph: i * 1.7, flash: 0 }));
}
function updateDeco(dt) { for (const m of deco) { m.age += dt; m.x += m.vx * dt + Math.sin(m.age * .7 + m.ph) * 20 * dt; m.y += m.vy * dt + Math.cos(m.age * .6 + m.ph) * 16 * dt; if (m.x < -60) m.x = W + 60; if (m.x > W + 60) m.x = -60; if (m.y < 40 || m.y > H - 40) m.vy *= -1; } }

function render(t) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  let sx = 0, sy = 0; if (shake > 0 && !reduceMotion) { sx = rnd(-1, 1) * shake * 9; sy = rnd(-1, 1) * shake * 9; }
  ctx.save(); ctx.translate(sx, sy);
  drawBackground(t);
  if (state === 'menu' || state === 'loading') { for (const m of deco) drawMonster(m, t, .45); }
  else {
    if (state === 'ready') for (const m of deco) drawMonster(m, t, .22);
    if (runMode === 'motion' && Cam.ready && state !== 'result') Motion.draw(S.eye || state === 'ready' ? .95 : .5);
    if (runMode === 'ai' && Cam.ready && (S.eye || state === 'ready' || state === 'countdown')) drawHands();
    if (state !== 'result') drawGhostRace();
    if (state !== 'result') { const fa = state === 'finish' ? clamp(1 - finT / 1.2, 0, 1) : 1; for (const m of monsters) drawMonster(m, t, fa); drawBoss(); for (const s of shots) drawShot(s, t, fa); }
    drawFx();
    if (state !== 'result' && state !== 'finish') drawTrails(t);
    if (state === 'play') drawGestureCharge(t);
  }
  ctx.restore();
  if (cracks.length) drawCracks();   // ヒビは画面のガラスに入るので、ゆれの外で描く
}

// ============================================================
//  メインループ
// ============================================================
function step(dt, t) {
  frameCount++;
  shown = lerp(shown, score, 1 - Math.pow(.0005, dt));
  gridPhase = (gridPhase + dt * (state === 'play' ? 1.6 : .35)) % 1;
  if (shake > 0) shake = Math.max(0, shake - dt * 2.5); if (flashRed > 0) flashRed = Math.max(0, flashRed - dt * 2.2);
  if (state !== 'paused') { updateFx(dt); if (cracks.length) { for (const c of cracks) c.life -= dt; cracks = cracks.filter(c => c.life > 0); } }
  const live = state === 'ready' || state === 'countdown' || state === 'play';
  if (live && Cam.ready) {
    if (runMode === 'ai') { for (const p of ptrs) p.miss += dt; aiStep(t, dt); for (const p of ptrs) if (p.active && p.miss > .25) p.active = false; }
    else if (runMode === 'motion') Motion.update(Cam.video, Cam.cv);
  }
  if (runMode === 'mouse' && live) { ptrs[0].miss += dt; for (const p of ptrs) if (p.active && p.miss > 3) p.active = false; }
  if (state !== 'play') for (const p of ptrs) { p.ox = p.x; p.oy = p.y; }
  if (state === 'menu' || state === 'loading' || state === 'ready') updateDeco(dt);
  if (state === 'ready') updateReady(dt);
  else if (state === 'countdown') updateCountdown(dt);
  else if (state === 'play') updatePlay(dt);
  else if (state === 'finish') updateFinish(dt);
  else if (state === 'result') updateResult(dt);
  else if (state === 'loading') updateLoading(dt);
  updateHUD();
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  try { step(dt, now / 1000); render(now / 1000); } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}
initDeco(); requestAnimationFrame(frame);

// 先生・テスト用: ブラウザのコンソールから状態をのぞける
window.__fs = { S, TUNING, MON, AI, Motion, Music, ptrs, SPR, get state() { return state; }, get mode() { return runMode; }, get score() { return score; }, get combo() { return maxCombo; }, get kills() { return kills; }, get bombs() { return bombs; }, get monsters() { return monsters; }, get timeLeft() { return timeLeft; }, set timeLeft(v) { timeLeft = v; }, get boss() { return boss; }, get bossAppeared() { return bossAppeared; }, get shots() { return shots; }, get reflects() { return reflects; }, get shotHits() { return shotHits; }, get combo2() { return combo; }, get ghostSamples() { return ghostSamples; }, get previousGhost() { return previousGhost; }, get elapsed() { return elapsed; }, launchShot, get feverT() { return feverT; }, get rev() { return rev; }, get spGauge() { return spGauge; }, get fx() { return fx; }, set spGauge(v) { spGauge = v; }, get barrierT() { return barrierT; }, get gestureTr() { return gestureTrs[0]; }, get gestureTrs() { return gestureTrs; }, get merges() { return merges; }, get pkills() { return pkills; }, get monCfg() { return monCfg; }, get customOn() { return customOn; }, chooseType, onHit, fireSpecial, spawn, startFlow, updatePlay, testHits, renderBoard, banner, confetti };
if (qs.get('autostart') === '1') startFlow();
