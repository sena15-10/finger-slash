import { TUNING, CALLS, TIPS, MP_VERSION, CDN, MODEL_URLS } from '../config.js';
import { MON } from './monsters.js';
import { comboMultiplier, rankForScore } from './scoring.js';
import { createEffects } from '../render/effects.js';
import { createAudio } from '../audio/audio.js';
import { createCamera } from '../input/camera.js';
import { createMotion } from '../input/motion.js';
import { createAttacks } from './attacks.js';
import { bossHpPercent, createBoss, damageBoss, damageBossFlat, reflectDamageBoss, shouldSpawnBoss, updateBoss, updateBossShots } from './boss.js';
import { createGhostSample, ghostResultText, hasAnyHand, normalizeGhostPoint, packGhost, sampleGhost, unpackGhost } from './ghost.js';
import { addGauge, classifyHandShape, consumeFist, createGestureState, shotInsideShield, tryActivateShield, updateHold, updateShieldTimers } from './gesture.js';
import { creditBossResult, makeTwoEntry, playerIndexForX as sideOfX, pruneTwoScores, removeTodayTwoScores, selectTwoPlayerHands, slashCooldownKey, twoBoardRows, twoPlayerVerdict, validTwoEntries } from './two.js';


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
const S = {
  mode: oneOf(qs.get('mode'), ['ai', 'motion', 'mouse'], oneOf(store.get('mode', 'ai'), ['ai', 'motion', 'mouse'], 'ai')),
  diff: oneOf(qs.get('diff'), ['easy', 'normal', 'hard'], oneOf(store.get('diff', 'normal'), ['easy', 'normal', 'hard'], 'normal')),
  time: oneOf(parseInt(qs.get('time'), 10), [30, 60], oneOf(parseInt(store.get('time', 30), 10), [30, 60], 30)),
  sound: qs.get('mute') === '1' ? false : !!store.get('sound', true),
  eye: qs.get('eye') === '1',
  booth: qs.has('booth') ? qs.get('booth') !== '0' : store.get('booth', true) !== false,
  view: oneOf(qs.get('view'), ['show', 'blur', 'hide'], oneOf(store.get('view', 'show'), ['show', 'blur', 'hide'], 'show')),
  attack: qs.has('attack') ? qs.get('attack') !== '0' : store.get('attack', true) !== false,
  boss: qs.has('boss') ? qs.get('boss') !== '0' : store.get('boss', true) !== false,
  ghost: qs.has('ghost') ? qs.get('ghost') !== '0' : store.get('ghostEnabled', true) !== false,
  gesture: qs.has('gesture') ? qs.get('gesture') !== '0' : store.get('gesture', true) !== false,
  two: store.get('two', false) === true,   // 2人同時プレイ（AIハンドのときだけ）。URLオプションはなし
};
if (S.mode !== 'ai') S.two = false;
let soloTime = S.time;   // 2人プレイ中は60びょうに固定するので、1人用の選択を覚えておく
let twoSuspended = false;   // 「2人」の設定のまま、AIが使えなかったので このプレイだけ1人にしている
if (S.two) S.time = TUNING.two.duration;
const diffCfg = () => TUNING.difficulty[S.diff];
const AI_HANDS_SOLO = 3;   // 1人プレイのときにAIへ渡す手の数（2人プレイは TUNING.two.maxHands）
const aiHandCount = () => S.two ? TUNING.two.maxHands : AI_HANDS_SOLO;

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
  lm: null, p: null, numHands: 0, pHands: 0, hands: [], prev: [], valid: 0, lastVT: -1, errs: 0, ms: 0, info: '', slowShown: false, lastErr: null,
  // numHands がちがう設定で作ってあったら、作り直す（1人 ⇔ 2人 を切りかえたとき）
  ensure(numHands) {
    if (this.lm && this.numHands === numHands) return Promise.resolve(this.lm);
    if (this.lm) { try { this.lm.close(); } catch (e) { /* 何もしない */ } this.lm = null; this.p = null; }
    if (!this.p || this.pHands !== numHands) {
      const p = loadLandmarker(numHands).then(lm => {
        if (this.p !== p) { try { lm.close(); } catch (e) { /* 何もしない */ } throw new Error('superseded'); }
        this.lm = lm; this.numHands = numHands; return lm;
      }, e => { if (this.p === p) this.p = null; this.lastErr = e; throw e; });
      this.p = p; this.pHands = numHands;
    }
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
async function loadLandmarker(numHands) {
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
            baseOptions: { modelAssetBuffer: model.slice(), delegate }, runningMode: 'VIDEO', numHands,
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
  // 大きく写っている手（＝前に立っている人の手）から順に2つまで使う
  const all = (res && res.landmarks) ? res.landmarks : [], minPx = S.booth ? TUNING.boothMinHandPx : 0;
  AI.hands = all.map(h => { const pts = h.map(l => mapNorm(l.x, l.y)); return { lm: h, pts, raw: pts, size: Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y), ok: false }; });
  predictHands(t, dt * every);
  if (S.two) {   // 2人: 左右それぞれ、いちばん大きい手を1つずつ（真ん中の手は使わない）
    const picked = selectTwoPlayerHands(AI.hands, { width: W, minPx, centerDeadZone: TUNING.two.centerDeadZone });
    for (const h of picked) if (h) { h.ok = true; h.shape = S.gesture ? classifyHandShape(h.raw, TUNING.gesture) : 'none'; }
    AI.valid = picked.filter(Boolean).length;
    assignTwoPlayerHands(picked, t);
    return;
  }
  const valid = AI.hands.filter(h => h.size >= minPx).sort((a, b) => b.size - a.size).slice(0, 2);
  for (const h of valid) { h.ok = true; h.shape = S.gesture ? classifyHandShape(h.raw, TUNING.gesture) : 'none'; }
  AI.valid = valid.length;
  assignHands(valid, t);
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
function switchToMotion() {
  runMode = 'motion'; Motion.reset(); AI.hands = []; AI.valid = 0; for (const p of ptrs) p.active = false;
  if (S.two) dropTwoPlayer();
}
// 2人プレイ中にAIが止まったとき。モーションでは左右の人を見分けられないので、2人プレイを続けない
//  プレイ中: そこまでの点数で2人の結果を出す（途中で終わったので、ランキングには残さない）
//  カウントダウン中: 1人用で数えなおす ／ 待機画面: そのまま1人にする
// 保存した「2人」の設定は変えない（メニューに戻ると元にもどる）
function dropTwoPlayer() {
  const wasPlaying = state === 'play';
  if (wasPlaying) endRound({ save: false });
  twoSuspended = true; S.two = false; syncTwoUI({ persist: false });
  if (state === 'countdown') startCountdown();
  toast(wasPlaying
    ? 'AIが止まったので、2人プレイをここで終わりにしました（この回の記録は残しません）。次からはモーションで1人ずつ遊べます'
    : 'AIが止まったので、モーションモードの1人プレイに切りかえました。メニューに戻ると「2人」の設定にもどります', 9000);
}

// ============================================================
//  ゆび（ポインタ）… AIの手 / マウス / タッチ のどれでも同じように扱う
// ============================================================
const mkPtr = color => ({ active: false, x: 0, y: 0, ox: 0, oy: 0, miss: 0, trail: [], color, shape: 'none', palm: { x: 0, y: 0 } });
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
// hands: AI.hands から選ばれた手（.pts に21点、.shape に 'fist'/'open'/'none'）
function assignHands(hands, t) {
  const tips = hands.map(h => ({ x: clamp(h.pts[8].x, 0, W), y: clamp(h.pts[8].y, 0, H) }));   // 8番 = 人さし指の先
  const used = new Set();
  for (const p of ptrs) {
    if (!p.active) continue; let bi = -1, bd = 1e9;
    tips.forEach((q, i) => { if (used.has(i)) return; const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; bi = i; } });
    if (bi < 0 || bd >= 260) continue;
    used.add(bi);
    const hand = hands[bi]; p.shape = hand.shape || 'none'; p.palm = hand.pts[9];
    if (p.shape === 'fist') { p.miss = 0; continue; }   // グーの間は、誤って斬らないように位置を更新しない
    // 止めているときはよく平均して「ぷるぷる」を消し、速く動かしたときはほぼそのまま追いかけて遅れを出さない
    ptrMove(p, tips[bi].x, tips[bi].y, t, clamp(TUNING.ai.smoothMin + bd / TUNING.ai.smoothDist, TUNING.ai.smoothMin, TUNING.ai.smoothMax));
  }
  tips.forEach((q, i) => {
    if (used.has(i)) return; const p = ptrs.find(pp => !pp.active); if (!p) return;
    used.add(i); const hand = hands[i]; p.shape = hand.shape || 'none'; p.palm = hand.pts[9];
    ptrMove(p, q.x, q.y, t, 1);
  });
}
// 2人プレイ: picked = [左の手 or null, 右の手 or null]。ptrs[0] は いつも左の人、ptrs[1] は いつも右の人
function assignTwoPlayerHands(picked, t) {
  picked.forEach((hand, pi) => {
    if (!hand) return;   // 見えない側は、miss がたまって自然に消える
    const p = ptrs[pi], x = clamp(hand.pts[8].x, 0, W), y = clamp(hand.pts[8].y, 0, H);
    p.shape = hand.shape || 'none'; p.palm = hand.pts[9];
    if (p.shape === 'fist') { p.miss = 0; return; }   // グーの間は、誤って斬らないように位置を更新しない
    const bd = p.active ? Math.hypot(x - p.x, y - p.y) : 0;
    ptrMove(p, x, y, t, p.active ? clamp(TUNING.ai.smoothMin + bd / TUNING.ai.smoothDist, TUNING.ai.smoothMin, TUNING.ai.smoothMax) : 1);
  });
}
function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function stagePoint(e) { const r = cv.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width * W, 0, W), y: clamp((e.clientY - r.top) / r.height * H, 0, H) }; }
const mouseOK = () => runMode === 'mouse' && state !== 'menu' && state !== 'loading' && state !== 'result';
function mouseMove(e) {
  if (!mouseOK()) return;
  const p = stagePoint(e); ptrs[0].palm = p;
  if (S.gesture && mouseFistDown) { ptrs[0].active = true; ptrs[0].miss = 0; return; }   // グー中は、誤って斬らないように位置を更新しない
  ptrMove(ptrs[0], p.x, p.y, performance.now() / 1000, 1);
}
stage.addEventListener('pointermove', mouseMove);
stage.addEventListener('pointerdown', mouseMove);
stage.addEventListener('pointerleave', () => { if (runMode === 'mouse') ptrs[0].active = false; });
stage.addEventListener('pointerup', e => { if (e.pointerType === 'touch') ptrs[0].active = false; });
// マウスの代わり: 右クリック長おし＝グー、Shift長おし＝パー（?gesture=0 のときは、どちらも効果なし）
let mouseFistDown = false, mouseOpenDown = false;
stage.addEventListener('contextmenu', e => { if (S.gesture) e.preventDefault(); });
stage.addEventListener('pointerdown', e => { if (runMode === 'mouse' && S.gesture && e.button === 2) mouseFistDown = true; });
window.addEventListener('pointerup', e => { if (e.button === 2) mouseFistDown = false; });
window.addEventListener('blur', () => { mouseFistDown = false; mouseOpenDown = false; });
window.addEventListener('keydown', e => { if (runMode === 'mouse' && S.gesture && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) mouseOpenDown = true; });
window.addEventListener('keyup', e => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') mouseOpenDown = false; });
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
let score2 = 0, shown2 = 0, combo2 = 0, maxCombo2 = 0, comboT2 = 0, kills2 = 0, bombs2 = 0;   // 2人プレイの右の人（左の人は上の score などを使う）
let shake = 0, flashRed = 0, hitStop = 0, gridPhase = 0, readyT = 0, readyLock = 0, readyShown = '', starting = false;
let cdT = 0, cdStage = -1, finT = 0, finWiping = false, hintT = 0, lastShown = false, lastSec = 99;
let entry = null, entryDefault = '', lastAt = 0, autoT = 0, autoMsg = '', resultSeq = 0, resultArmed = false;
let attractT = 0, attractPage = 0, loadTipT = 0, wakeLock = null;
let shots = [], shotT = 0, reflects = 0, shotHits = 0, cracks = [], attackHinted = false;
let boss = null, bossAppeared = false, bossDefeated = false;
let previousGhost = null, ghostSamples = [], ghostLastSampleT = -Infinity;
let gestureStates = [createGestureState()], gestureFlashT = 0, gestureShakeT = 0;
// ---- プレイヤー番号（pi）: 0 = 1人プレイ / 2人プレイの左の人、1 = 2人プレイの右の人 ----
const playerIndexForPtr = p => S.two && p === ptrs[1] ? 1 : 0;
const playerIndexForX = x => sideOfX(x, W, S.two);
const playerPtrs = pi => S.two ? [ptrs[pi]] : ptrs;
const scoreOf = pi => pi ? score2 : score;
function setScore(pi, v) { if (pi) score2 = v; else score = v; }
function addScore(pi, v) { setScore(pi, scoreOf(pi) + v); }
const comboOf = pi => pi ? combo2 : combo;
function resetCombo(pi) { if (pi) { combo2 = 0; comboT2 = 0; } else { combo = 0; comboT = 0; } }
const maxComboOf = pi => pi ? maxCombo2 : maxCombo;
const killsOf = pi => pi ? kills2 : kills;
function addKill(pi) { if (pi) kills2++; else kills++; }
const bombsOf = pi => pi ? bombs2 : bombs;
function addBomb(pi) { if (pi) bombs2++; else bombs++; }
const { Snd, Music } = createAudio({ TUNING, getSound: () => S.sound, getTimeLeft: () => timeLeft, getFever: () => feverT });
const effectState = { get fx() { return fx; }, set fx(value) { fx = value; } };
const { burst, ring, addText, addSlash, confetti, updateFx } = createEffects({ state: effectState, clamp, rnd, pick, TAU, W, FX, FB });
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
const { updateAttacks, launchShot, reflectShot } = createAttacks({
  TUNING, MON, S, state: attackState, rnd, rndi, pick, clamp, lerp, TAU, W, H, Snd, banner, bumpCombo, multOf, burst, ring, addSlash, addText,
  addScore, resetCombo, playerIndexForPtr, playerIndexForX,
  isBossActive: () => !!boss && boss.hp > 0,
  getBossPos: () => boss ? { x: boss.x, y: boss.y } : null,
  onBossReflectHit: s => {
    if (!boss || boss.hp <= 0) return false;
    if (Math.hypot(s.x - boss.x, s.y - boss.y) > TUNING.boss.radius + s.r) return false;
    const result = reflectDamageBoss(boss, TUNING.boss);
    if (!result.applied) return false;
    applyBossDamageResult(result, `-${TUNING.boss.reflectDamage}`, s.reflectedByPi ?? 0);   // はね返した人のダメージ
    return true;
  },
});

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
  const T = MON[type], sp = diffCfg().speed;
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
  let sum = 0; for (const k in w) sum += w[k]; let r = Math.random() * sum;
  let type = 'slime'; for (const k in w) { r -= w[k]; if (r <= 0) { type = k; break; } }
  if (type === 'bomb' && monsters.filter(m => m.type === 'bomb').length >= 2) type = 'slime';
  if (type === 'star') starCool = 16;
  return type;
}
function updateSpawner(dt) {
  if (starCool > 0) starCool -= dt;
  const maxMonsters = boss && boss.hp > 0 ? TUNING.boss.maxMonsters : TUNING.maxMonsters;
  spawnT -= dt; if (spawnT > 0 || monsters.length >= maxMonsters) return;
  const p = elapsed / S.time, D = diffCfg();
  spawnT = D.spawn * (1 - .45 * p) * rnd(.75, 1.25) * (feverT > 0 ? .65 : 1);
  const n = (Math.random() < .12 && elapsed > 5) ? rndi(2, 3) : 1;
  for (let i = 0; i < n && monsters.length < maxMonsters; i++) spawn(chooseType());
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
function multOf(pi = 0) { return comboMultiplier(comboOf(pi), feverT > 0); }
function maybeSpawnBoss() {
  const appearAt = TUNING.boss.appearAt[S.time] ?? TUNING.boss.appearAt[30];
  if (!shouldSpawnBoss(S.boss, bossAppeared, timeLeft, appearAt)) return;
  bossAppeared = true;
  const hp = TUNING.boss.hp[S.time] ?? TUNING.boss.hp[30];
  boss = createBoss(TUNING.boss, hp, W, H, elapsed);
  if (monsters.length > TUNING.boss.maxMonsters) monsters.length = TUNING.boss.maxMonsters;
  shots = [];
  banner('キングがあらわれた！', 'warn band', 1800);
  Snd.alarm();
}
// pi: このダメージを与えた人。撃破ボーナスは、最後にダメージを与えた人に入る
function applyBossDamageResult(result, label, pi = 0) {
  burst(boss.x, boss.y, TUNING.boss.color, 14, 260, .55);
  addText(boss.x, boss.y - TUNING.boss.radius, label, '#ffffff', 28);
  if (result.defeated) {
    bossDefeated = true;
    creditBossResult(result, pi, addScore);
    ring(boss.x, boss.y, TUNING.boss.color, TUNING.boss.radius * 2);
    banner('ボスをたおした！', 'call c5', 1700, `+${result.bonus}点`);
    Snd.big();
    confetti(70);
    shots = shots.filter(s => !s.fromBoss);   // ボスの火の玉は、はね返し扱いにせず消す
  } else {
    Snd.hurt();
  }
}
function updateBossAttacks() {
  if (!boss || boss.hp <= 0 || !S.attack) return;   // 「てきの攻撃」オフなら、ボスも火の玉を投げない
  const activeBossShots = shots.filter(s => s.fromBoss && !s.gone && s.st !== 'back').length;
  const action = updateBossShots(boss, elapsed, TUNING.boss, activeBossShots);
  if (action === 'launch') {
    const desired = boss.pendingPattern === 'triple' ? 3 : boss.pendingPattern === 'double' ? 2 : 1;
    const count = Math.min(desired, Math.max(0, TUNING.boss.maxShots - activeBossShots));
    if (count === 0) return;
    launchShot({
      forceFrom: boss,
      windup: TUNING.boss.telegraph,
      radius: TUNING.boss.radius,
      count,
      targetX: W / 2,
      targetY: H * 0.72,
      spread: 150,
    });
  }
}
// ---- 手の技（グー・パー）----
// 1人プレイは両手（ptrs全体）、2人プレイは自分の側の手だけから、手の形を見る
function gestureHandAt(pi, shape) { return playerPtrs(pi).find(p => p.active && p.shape === shape); }
function updateGesture(dt) {
  if (!S.gesture) return;
  for (let pi = 0; pi < gestureStates.length; pi++) {
    const g = gestureStates[pi];
    const isFist = runMode === 'mouse' ? mouseFistDown : !!gestureHandAt(pi, 'fist');
    const isOpen = runMode === 'mouse' ? mouseOpenDown : !!gestureHandAt(pi, 'open');
    updateHold(g.fist, isFist, dt, TUNING.gesture.graceMs);
    updateHold(g.open, isOpen, dt, TUNING.gesture.graceMs);
    updateShieldTimers(g, dt);
    if (runMode === 'mouse') { g.shieldX = ptrs[0].palm.x; g.shieldY = ptrs[0].palm.y; }
    else { const hand = gestureHandAt(pi, 'open'); if (hand) { g.shieldX = hand.palm.x; g.shieldY = hand.palm.y; } }   // 手を見失っても、最後の位置に残る
    if (consumeFist(g, TUNING.gesture)) triggerFistBurst(pi);
    if (tryActivateShield(g, TUNING.gesture)) { Snd.select(); burst(g.shieldX, g.shieldY, '#4FC3F7', 18, 240, .5); }
  }
}
function triggerFistBurst(pi = 0) {
  const mult = multOf(pi);   // コンボ倍率はかかるが、コンボ数は増やさない
  for (const m of monsters) {
    if (m.dead) continue;
    if (!MON[m.type].bad) {
      const pts = MON[m.type].pts * mult; addScore(pi, pts); addKill(pi);
      burst(m.x, m.y, MON[m.type].color, 12, 260, .55); addText(m.x, m.y - 8, `+${pts}`, '#ffe66b', 24);
    }
    m.dead = true;
  }
  monsters = monsters.filter(m => !m.dead);
  if (boss && boss.hp > 0) {
    const result = damageBossFlat(boss, TUNING.gesture.fistBossDamage, TUNING.boss);
    if (result.applied) applyBossDamageResult(result, `-${TUNING.gesture.fistBossDamage}`, pi);
  }
  for (const s of shots) s.gone = true;   // 飛んでくる火の玉をすべて消す（はね返し扱いにしない）
  shots = shots.filter(s => !s.gone);
  gestureFlashT = TUNING.gesture.flashSec; gestureShakeT = TUNING.gesture.shakeSec;
  Snd.big();
}
function testHits(dt = 0) {
  if (boss && boss.hp > 0) {
    for (const p of ptrs) {
      if (!p.active || boss.hp <= 0) continue;
      const speed = dt > 0 ? Math.hypot(p.x - p.ox, p.y - p.oy) / dt : 0;
      if (speed < TUNING.boss.minSlashSpeed || segDist(p.ox, p.oy, p.x, p.y, boss.x, boss.y) > TUNING.boss.radius) continue;
      const result = damageBoss(boss, speed, TUNING.boss, slashCooldownKey(ptrs.indexOf(p), S.two));   // 1人プレイは両手で1つのクールダウン
      if (!result.applied) continue;
      const pi = playerIndexForPtr(p);
      if (S.gesture) addGauge(gestureStates[pi], TUNING.gesture.gaugeBossHit);
      applyBossDamageResult(result, `-${TUNING.boss.slashDamage}`, pi);
      if (!S.two) break;   // 2人プレイは、同じコマに2人とも斬れる（クールダウンは人ごと）
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
    if (S.gesture && gestureStates.some(g => shotInsideShield(s.x, s.y, g, TUNING.gesture.shieldRadius))) {
      s.gone = true; burst(s.x, s.y, '#4FC3F7', 14, 220, .4); continue;   // 盾の中：はじき返しもボスダメージもなし
    }
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
  const ang = Math.atan2(dy, dx), pi = playerIndexForPtr(p);   // 斬った人が、点数とゲージを得る
  if (T.bad) { bombHit(m, pi); return; }
  m.hp--; m.flash = .15; m.cool = .3;
  addSlash(m.x, m.y, ang, m.r);
  if (m.hp > 0) { burst(m.x, m.y, T.color, 8, 220, .5); Snd.hurt(); shake = Math.max(shake, .25); addText(m.x, m.y - m.r - 8, `あと${m.hp}`, '#fff', 20); return; }
  kill(m, pi);
}
function kill(m, pi = 0) {
  const T = MON[m.type]; m.dead = true; addKill(pi);
  bumpCombo(pi);
  if (S.gesture) addGauge(gestureStates[pi], TUNING.gesture.gaugeEnemy);
  if (T.fever) {
    feverT = Math.min(TUNING.feverSeconds * 1.5, feverT + TUNING.feverSeconds);
    banner('FEVER TIME!!', 'fever band', 1500, `${TUNING.feverSeconds}びょう間 とくてん2ばい`); ring(m.x, m.y, T.color, 160); Snd.star();
  }
  const mult = multOf(pi), pts = T.pts * mult; addScore(pi, pts);
  burst(m.x, m.y, T.color, m.type === 'golem' ? 30 : 16, m.type === 'golem' ? 380 : 280, .75); ring(m.x, m.y, T.color, m.r * 2.2);
  addText(m.x, m.y - 8, `+${pts}`, mult > 1 ? '#ffe66b' : '#a6ff3d', 26 + Math.min(12, mult * 2));
  if (m.type === 'golem') { Snd.big(); shake = Math.max(shake, .55); hitStop = .07; } else Snd.hit(comboOf(pi));
}
// pi: コンボを伸ばす人（コンボ数ではなく、プレイヤー番号）
function bumpCombo(pi = 0) {
  let c;
  if (pi) { c = combo2 = (comboT2 > 0 ? combo2 : 0) + 1; comboT2 = TUNING.comboWindow; maxCombo2 = Math.max(maxCombo2, c); }
  else { c = combo = (comboT > 0 ? combo : 0) + 1; comboT = TUNING.comboWindow; maxCombo = Math.max(maxCombo, c); }
  const call = CALLS.find(k => k[0] === c);
  if (call) { banner(call[1], 'call ' + call[2], 950); Snd.chime(CALLS.indexOf(call)); }
}
function bombHit(m, pi = 0) {
  m.dead = true; addBomb(pi); resetCombo(pi); timeLeft = Math.max(0, timeLeft - TUNING.bombPenaltySeconds); setScore(pi, Math.max(0, scoreOf(pi) - 50));
  shake = 1; flashRed = 1; burst(m.x, m.y, '#ff4d5e', 30, 420, .9); burst(m.x, m.y, '#ffd24d', 18, 300, .7); ring(m.x, m.y, '#ff4d5e', 170);
  banner('BOMB!', 'bomb', 900, `−${TUNING.bombPenaltySeconds}びょう`); Snd.bomb();
}
// ---- てきの攻撃（火の玉）: 遠くから大きくなりながら飛んでくる。斬ればはじき返せる ----
async function startFlow() {
  const my = ++flowId; Snd.init(); keepAwake();
  setState('loading'); loadTipT = 0; $('#loadTip').textContent = pick(TIPS);
  showLoading('カメラを準備しています…', 'ブラウザに「カメラを使う」と出たら、「許可」をおしてね。', false, true);
  runMode = S.mode;
  if (runMode !== 'mouse') {
    try { await Cam.start(); }
    catch (e) { if (my !== flowId) { Cam.stop(); return; } toast(camMessage(e), 8000); runMode = 'mouse'; Cam.stop(); }
  }
  if (my !== flowId) { Cam.stop(); return; }
  if (runMode === 'ai') {
    showLoading('AIを準備しています…', 'はじめては少し時間がかかります（目安: 10〜40びょう）。次からは早くなります。', true, true);
    const res = await Promise.race([AI.ensure(aiHandCount()).then(() => 'ok', () => 'fail'), new Promise(r => { skipResolve = () => r('skip'); })]);
    skipResolve = null; if (my !== flowId) { Cam.stop(); return; }
    if (res !== 'ok') { runMode = 'motion'; toast(res === 'skip' ? 'モーションモードで始めます' : 'AIを読みこめなかったので、モーションモードで始めます。ネットの接続を確認してね。', 7000); }
  }
  // 2人プレイはAIハンドのときだけ。AIが使えなかったら、このプレイだけ1人にする（保存した「2人」の設定は変えない。メニューにもどると元にもどる）
  if (runMode !== 'ai' && S.two) { twoSuspended = true; S.two = false; syncTwoUI({ persist: false }); }
  if (runMode === 'motion') Motion.reset();
  AI.hands = []; AI.valid = 0; AI.lastVT = -1; for (const p of ptrs) { p.active = false; p.trail.length = 0; }
  enterReady(false);
}
function showLoading(msg, sub, canSkip, canCancel) {
  $('#loadMsg').textContent = msg; $('#loadSub').textContent = sub || '';
  $('#skipAI').style.display = canSkip ? '' : 'none'; $('#cancelLoad').style.display = canCancel ? '' : 'none';
  $('#loadMeter').style.visibility = canSkip ? 'visible' : 'hidden'; if (canSkip) $('#loadBar').style.width = '0%';
}
function updateLoading(dt) { loadTipT += dt; if (loadTipT > 3.5) { loadTipT = 0; $('#loadTip').textContent = pick(TIPS); } }

// ---- 待機画面 ----
const READY_TEXT = {
  booth: { ai: '手をカメラにかざすとスタート！', motion: '手を大きくふるとスタート！', mouse: 'マウスを動かすとスタート' },
  normal: { ai: '手をカメラにかざすとスタート！', motion: '手を大きくふるとスタート！', mouse: 'マウスを動かすとスタート（タッチはなぞる）' },
};
function setReadyText() {
  const m = readyLock > 0 ? 'つぎの人、どうぞ！' : READY_TEXT[S.booth ? 'booth' : 'normal'][runMode];
  if (m !== readyShown) { readyShown = m; $('#readyText').textContent = m; $('#cta').classList.toggle('lock', readyLock > 0); }
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
  const ok = runMode === 'ai' ? AI.valid > 0 : runMode === 'motion' ? Motion.energy > .012 : ptrs[0].active;
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
  score2 = 0; shown2 = 0; combo2 = 0; maxCombo2 = 0; comboT2 = 0; kills2 = 0; bombs2 = 0;
  timeLeft = S.time; elapsed = 0; spawnT = .6; shake = 0; flashRed = 0; hitStop = 0; lastShown = false; lastSec = 99;
  shots = []; cracks = []; shotT = TUNING.attacks.startAfter; reflects = 0; shotHits = 0; attackHinted = false;
  boss = null; bossAppeared = false; bossDefeated = false;
  previousGhost = ghostOn() ? unpackGhost(store.get('ghost_' + S.time, null)) : null;
  ghostSamples = []; ghostLastSampleT = -Infinity;
  gestureStates = S.two ? [createGestureState(), createGestureState()] : [createGestureState()]; gestureFlashT = 0; gestureShakeT = 0;
}
const ghostOn = () => S.ghost && !S.two;   // 2人プレイでは、ゴーストは使わない
function currentGhostPoints() {
  return ptrs.filter(p => p.active).map(p => normalizeGhostPoint(p.x, p.y, W, H));
}
function pushGhostSample() {
  ghostSamples.push(createGhostSample(elapsed, currentGhostPoints(), score));
}
function recordGhostSamples() {
  if (!ghostOn()) return;
  if (elapsed - ghostLastSampleT < TUNING.ghost.interval) return;
  ghostLastSampleT = elapsed;
  pushGhostSample();
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
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
  if (comboT2 > 0) { comboT2 -= dt; if (comboT2 <= 0) combo2 = 0; }
  maybeSpawnBoss();
  updateBoss(boss, dt, TUNING.boss, W, H);
  updateBossAttacks();
  updateSpawner(dt);
  for (const m of monsters) updateMonster(m, dt);
  updateAttacks(dt);
  testHits(dt);
  updateGesture(dt);
  monsters = monsters.filter(m => !m.dead);
  recordGhostSamples();
  if (!lastShown && timeLeft <= 10 && S.time > 12) { lastShown = true; banner('ラスト10びょう！', 'last band', 1400); Snd.alarm(); }
  const sec = Math.ceil(timeLeft); if (sec !== lastSec) { lastSec = sec; if (sec <= 5 && sec > 0) Snd.tick(); }
  if (timeLeft <= 0) { timeLeft = 0; finishRound(); }
}
function finishRound() {
  if (ghostOn()) pushGhostSample();   // ラウンド終了時点の記録を最後に1つ足す
  setState('finish'); finT = 0; finWiping = false; Music.stop(); banner('FINISH!', 'finish', 1600); Snd.whistle();
}
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
function rankOf(sc) { return rankForScore(sc, S.time, S.diff); }
// ---- 記録（この端末のブラウザの中だけに保存）----
const dayKey = ts => { const d = new Date(ts || 0); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function allScores() { const l = store.get('scores', []); return Array.isArray(l) ? l.filter(e => e && typeof e.s === 'number') : []; }
function todayScores() { const k = dayKey(Date.now()); return allScores().filter(e => dayKey(e.at) === k).sort((a, b) => b.s - a.s); }
function saveScores(list) {   // 今日の記録はぜんぶ、ほかの日はベスト50だけ残す
  const k = dayKey(Date.now());
  const td = list.filter(e => dayKey(e.at) === k).slice(-2950), old = list.filter(e => dayKey(e.at) !== k).sort((a, b) => b.s - a.s).slice(0, 50);
  store.set('scores', td.concat(old));
}
// 2人プレイ用のランキング（1人用の 30/60びょう のボードとは別のキー）。1件 = { total, l, r, ts }
function allTwoScores() { return validTwoEntries(store.get('scoresTwo', [])); }
function todayTwoScores() { const k = dayKey(Date.now()); return allTwoScores().filter(e => dayKey(e.ts) === k).sort((a, b) => b.total - a.total); }
function saveTwoScores(list) { store.set('scoresTwo', pruneTwoScores(list, dayKey(Date.now()), dayKey)); }
// ---- けっか画面（順番に出していく）----
// save: false のときは、ランキングに残さない（2人プレイがAIの停止で途中で終わったとき）
function endRound({ save = true } = {}) {
  Music.stop(); feverT = 0;
  $('#result').classList.toggle('two', S.two);
  if (S.two) { endRoundTwo({ save }); return; }
  if (ghostOn() && ghostSamples.length && hasAnyHand(ghostSamples)) {
    try { store.set('ghost_' + S.time, packGhost(ghostSamples)); } catch (e) { /* 保存できなくても遊べるようにする */ }
  }
  const rk = rankOf(score), em = $('#emblem'); $('#rankLetter').textContent = rk; em.dataset.rank = rk;
  $('#resScore').textContent = '0'; $('#resCombo').textContent = String(maxCombo); $('#resKills').textContent = String(kills); $('#resBombs').textContent = String(bombs);
  $('#resReflect').textContent = String(reflects); $('#st4').hidden = !S.attack; $('#rStats').classList.toggle('four', S.attack);
  const bossRemaining = bossAppeared && !bossDefeated && boss && boss.hp > 0;
  $('#bossResult').hidden = !bossRemaining;
  if (bossRemaining) $('#bossResult').textContent = `ボスのHP 残り${bossHpPercent(boss)}%`;
  const ghostResult = ghostOn() ? ghostResultText(score, previousGhost) : '';
  $('#ghostResult').hidden = !ghostResult;
  if (ghostResult) $('#ghostResult').textContent = ghostResult;
  $('#secret').innerHTML = '<b>AIのひみつ</b>　' + pick(SECRETS);
  const nm = $('#nameInput');
  const before = S.booth ? todayScores() : allScores().sort((a, b) => b.s - a.s);
  entryDefault = S.booth ? `プレイヤー${todayScores().length + 1}` : 'ななし';
  nm.value = S.booth ? '' : store.get('name', ''); nm.placeholder = S.booth ? entryDefault : 'ニックネーム';
  entry = { n: nm.value || entryDefault, s: score, m: runMode, d: S.diff, t: S.time, at: Date.now() }; lastAt = entry.at;
  const list = allScores(); list.push(entry); saveScores(list);
  const td = todayScores(), pos = 1 + td.filter(e => e.s > entry.s).length;
  const best = score > 0 && (!before.length || score > before[0].s);
  $('#todayRank').innerHTML = `本日 <b>${pos}</b>位 ／ ${td.length}人中`;
  $('#newRec').textContent = S.booth ? '本日 1位！' : 'ハイスコア！';
  $('#again').querySelector('span').textContent = S.booth ? 'つぎの人へ' : 'もういっかい';
  for (const el of document.querySelectorAll('#result .rv, #emblem, #newRec')) el.classList.remove('show');
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
// 2人プレイのけっか: 「左の人 ◯点」「右の人 ◯点」を並べ、多いほうに「勝ち！」（同点は「ひきわけ！」）。名前入力は出さない
function endRoundTwo({ save = true } = {}) {
  const l = score, r = score2, verdict = twoPlayerVerdict(l, r);
  const bossRemaining = bossAppeared && !bossDefeated && boss && boss.hp > 0;
  $('#bossResult').hidden = !bossRemaining;
  if (bossRemaining) $('#bossResult').textContent = `ボスのHP 残り${bossHpPercent(boss)}%`;
  $('#ghostResult').hidden = true;
  $('#resL').textContent = '0'; $('#resR').textContent = '0';
  $('#winL').textContent = verdict === 'l' ? '勝ち！' : ''; $('#winR').textContent = verdict === 'r' ? '勝ち！' : '';
  $('#twoDraw').textContent = verdict === 'draw' ? 'ひきわけ！' : '';
  $('#tpL').classList.toggle('win', verdict === 'l'); $('#tpR').classList.toggle('win', verdict === 'r');
  const e = makeTwoEntry(l, r, Date.now()); entry = null; lastAt = e.ts;
  if (save) { const list = allTwoScores(); list.push(e); saveTwoScores(list); }
  $('#again').querySelector('span').textContent = S.booth ? 'つぎの人へ' : 'もういっかい';
  for (const el of document.querySelectorAll('#result .rv, #emblem, #newRec, #twoResult .tp-win, #twoDraw')) el.classList.remove('show');
  autoT = TUNING.boothResultSeconds; autoMsg = ''; resultArmed = false; $('#autoNext').textContent = ''; $('#autoBar').style.width = '100%';
  setState('result'); renderBoard();
  const sid = ++resultSeq, res = $('#result');
  const at = (ms, f) => setTimeout(() => { if (sid === resultSeq && state === 'result') f(); }, reduceMotion ? 0 : ms);
  at(60, () => { $('#rMain').classList.add('show'); Snd.select(); });
  at(350, () => { countUp(sid, l, 900, $('#resL')); countUp(sid, r, 900, $('#resR'), false); });
  at(1500, () => {
    for (const el of document.querySelectorAll('#twoResult .tp-win, #twoDraw')) el.classList.add('show');
    Snd.stamp(); res.classList.remove('shake'); void res.offsetWidth; if (!reduceMotion) res.classList.add('shake');
    if (verdict !== 'draw') { Snd.fanfare(); confetti(120); }
  });
  at(2100, () => { $('#rFoot').classList.add('show'); $('#autoWrap').classList.add('show'); resultArmed = true; });
}
function countUp(sid, target, ms, el = $('#resScore'), sound = true) {
  const t0 = performance.now(); let lastTick = 0;
  const f = now => {
    if (sid !== resultSeq) return; const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(target * e));
    if (k < 1) { if (sound && now - lastTick > 70) { lastTick = now; Snd.tick(); } requestAnimationFrame(f); }
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
function nextPlayer() { if (state !== 'result') return; resultSeq++; $('#nameInput').blur(); enterReady(true); }
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
  const td1 = todayScores(), tdTwo = todayTwoScores();
  // 2人プレイを選んでいるときは、2人専用のボード（合計点、名前の欄は「左◯／右◯」）を出す
  const td = S.two ? twoBoardRows(tdTwo) : td1;
  const list = S.booth ? td : S.two ? twoBoardRows(allTwoScores().sort((a, b) => b.total - a.total)) : allScores().sort((a, b) => b.s - a.s);
  $('#boardTitle').textContent = S.booth ? "TODAY'S BEST" : 'HIGH SCORE';
  fillBoard($('#board'), list.slice(0, 8), 'まだ記録がありません');
  $('#howAtk').hidden = !S.attack;
  fillBoard($('#board2'), td.slice(0, 10), 'まだ記録がありません。1番のりを目指そう！');
  const plays = td1.length + tdTwo.length, players = td1.length + tdTwo.length * 2;   // 2人プレイは1回で2人
  $('#todayCount').innerHTML = `本日の挑戦者 <b>${players}</b>人`; $('#staffCount').textContent = `今日のプレイ数：${plays}回`;
}
function toMenu() {
  flowId++; resultSeq++; starting = false; Music.stop(); Cam.stop(); Motion.reset(); AI.hands = []; AI.valid = 0; for (const p of ptrs) { p.active = false; p.trail.length = 0; }
  monsters = []; shots = []; cracks = []; fx = []; feverT = 0; fxEl.textContent = '';
  if (twoSuspended) { twoSuspended = false; S.two = S.mode === 'ai'; syncTwoUI({ persist: false }); }   // AIが使えず1人にしていたのを、設定どおりにもどす
  setState('menu'); renderBoard();
  const w = wakeLock; wakeLock = null; if (w) w.release().catch(() => {});
}
function pauseGame() { if (state !== 'play') return; setState('paused'); Music.stop(); }
function togglePause() {
  if (state === 'play') pauseGame();
  else if (state === 'paused') { for (const p of ptrs) { p.ox = p.x; p.oy = p.y; } setState('play'); Music.start(); }
}

// ============================================================
//  プレイ中の表示（HUD）… 値が変わったときだけ書きかえる
// ============================================================
const hud = { box: $('#hud'), score: $('#hScore'), lbl: $('#hLbl'), score2: $('#hScore2'), pc0: $('#hPc0'), pc1: $('#hPc1'), time: $('#hTime'), timeBox: $('#hTimeBox'), ring: $('#hRing'), combo: $('#hCombo'), comboN: $('#hComboN'), mult: $('#hMult'), cbar: $('#hCbar'), fever: $('#hFever'), fbar: $('#hFbar'), mode: $('#hMode'), hint: $('#hHint'), ghost: $('#hGhost'), ghostText: $('#hGhostText'), ghostBar: $('#hGhostBar') };
const hc = {};
function setIf(key, v, fn) { if (hc[key] !== v) { hc[key] = v; fn(v); } }
function updateHUD() {
  const on = state === 'countdown' || state === 'play' || state === 'paused' || state === 'finish';
  setIf('on', on, v => hud.box.classList.toggle('on', v)); if (!on) return;
  setIf('score', String(Math.round(shown)), v => { hud.score.textContent = v; });
  setIf('two', S.two, v => { hud.box.classList.toggle('two', v); hud.lbl.textContent = v ? '左の人' : 'SCORE'; });
  if (S.two) {   // 2人: 右の人の点数と、それぞれのコンボを、点数の箱の中に出す
    setIf('score2', String(Math.round(shown2)), v => { hud.score2.textContent = v; });
    const pc = pi => comboOf(pi) >= 2 ? `${comboOf(pi)} COMBO ×${multOf(pi)}` : '';
    setIf('pc0', pc(0), v => { hud.pc0.textContent = v; });
    setIf('pc1', pc(1), v => { hud.pc1.textContent = v; });
  }
  setIf('time', String(Math.max(0, Math.ceil(timeLeft))), v => { hud.time.textContent = v; });
  setIf('ring', Math.round(clamp(timeLeft / S.time, 0, 1) * 400), v => { hud.ring.style.strokeDashoffset = String(HOLD_C * (1 - v / 400)); });
  setIf('low', timeLeft <= 10 && state === 'play', v => hud.timeBox.classList.toggle('low', v));
  setIf('con', combo >= 2, v => hud.combo.classList.toggle('on', v));
  setIf('cn', combo, v => { if (v >= 2) { hud.comboN.textContent = String(v); hud.comboN.classList.remove('pop'); void hud.comboN.offsetWidth; hud.comboN.classList.add('pop'); } });
  setIf('mult', '×' + comboMultiplier(Math.max(1, combo), feverT > 0), v => { hud.mult.textContent = v; });
  setIf('cbar', Math.round(clamp(comboT / TUNING.comboWindow, 0, 1) * 50), v => { hud.cbar.style.width = (v * 2) + '%'; });
  setIf('fon', feverT > 0, v => hud.fever.classList.toggle('on', v));
  setIf('fbar', Math.round(clamp(feverT / TUNING.feverSeconds, 0, 1) * 50), v => { hud.fbar.style.width = (v * 2) + '%'; });
  setIf('mode', { ai: 'AIハンド', motion: 'モーション', mouse: 'マウス' }[runMode] + (runMode === 'ai' && AI.info ? `（${AI.info.split('/')[1]}）` : ''), v => { hud.mode.textContent = v; });
  const hint = runMode === 'mouse' ? 'マウスでモンスターにさわろう。ばくだんはさわらない！' : runMode === 'motion' ? '手を動かしてモンスターにふれよう。ばくだんはさけて！' : '人さし指でモンスターにさわろう。ばくだんはさけて！';
  setIf('hint', hint, v => { hud.hint.textContent = v; });
  setIf('hop', state === 'play' && hintT < 6 ? 1 : 0, v => { hud.hint.style.opacity = String(v); });
  const hasGhost = ghostOn() && previousGhost && previousGhost.length > 0;
  setIf('ghost-on', !!hasGhost, v => hud.ghost.classList.toggle('on', v));
  if (hasGhost) {
    const previousScore = Math.round(sampleGhost(previousGhost, elapsed).s);
    setIf('ghost-text', `前の人 ${previousScore}点 ／ いま ${score}点`, v => { hud.ghostText.textContent = v; });
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
bindRadios('gesture', 'gesture', v => v === '1', v => v ? '1' : '0');
bindRadios('two', 'two', v => v === '1', v => v ? '1' : '0');
document.querySelectorAll('input[name="time"]').forEach(el => el.addEventListener('change', () => { soloTime = S.time; }));
document.querySelectorAll('input[name="mode"], input[name="two"]').forEach(el => el.addEventListener('change', () => syncTwoUI()));
// 人数: 2人はAIハンドのときだけ。2人のあいだは TIME を60びょうに固定して選べなくする
// persist: false のときは、画面と S だけ合わせて、保存はしない（AIが使えなかったプレイの一時的な1人化）
function syncTwoUI({ persist = true } = {}) {
  const ai = S.mode === 'ai';
  if (!ai) S.two = false;   // モードがAIハンドでなくなったら、自動で1人にもどす
  if (persist) { store.set('two', S.two); twoSuspended = false; }   // 人が選び直したら、それが新しい設定
  S.time = S.two ? TUNING.two.duration : soloTime;
  document.querySelectorAll('input[name="two"]').forEach(el => { el.checked = (S.two ? '1' : '0') === el.value; if (el.value === '1') el.disabled = !ai; });
  $('#twoNote').hidden = ai;
  document.querySelectorAll('input[name="time"]').forEach(el => { el.disabled = S.two; el.checked = String(S.time) === el.value; });
  renderBoard();
}
syncTwoUI();
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
$('#again').addEventListener('click', () => { Snd.init(); if (S.booth) nextPlayer(); else { resultSeq++; enterReady(false); } });
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
  resetArm = 0; const k = dayKey(Date.now()); store.set('scores', allScores().filter(e => dayKey(e.at) !== k));
  store.set('ghost_30', null); store.set('ghost_60', null); store.set('scoresTwo', removeTodayTwoScores(store.get('scoresTwo', []), k, dayKey));
  previousGhost = null; ghostSamples = []; ghostLastSampleT = -Infinity;
  b.textContent = '今日の記録をリセット'; lastAt = 0; renderBoard(); toast('今日の記録をリセットしました', 3000);
});
document.querySelectorAll('.card, .chip, .gbtn').forEach(el => el.addEventListener('pointerenter', () => { if (Snd.ctx) Snd.move(); }));
syncBar();
window.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') { if (e.key === 'Enter') e.target.blur(); return; }
  const k = e.code;
  if (k === 'KeyP') togglePause();
  else if (k === 'Escape' || k === 'KeyS') { if (state === 'play') pauseGame(); else if (state !== 'menu') toMenu(); }
  else if (k === 'KeyN') nextPlayer();
  else if (k === 'KeyF') goFull(!document.fullscreenElement);
  else if (k === 'KeyM') { S.sound = !S.sound; store.set('sound', S.sound); Snd.init(); syncBar(); toast(S.sound ? '音 ON' : '音 OFF', 1500); }
  else if (k === 'KeyE') { S.eye = !S.eye; syncBar(); }
  else if ((k === 'Space' || k === 'Enter') && state === 'menu' && document.activeElement === document.body) { e.preventDefault(); if (S.booth) goFull(true); startFlow(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pauseGame(); if (!document.hidden && state !== 'menu') keepAwake(); });

// モンスターずかん（ゲーム内と同じ絵を小さく描く）
function drawIcon(type, canvas) {
  const dpr = 2, px = canvas.dataset.size | 0 || 48; canvas.width = px * dpr; canvas.height = px * dpr; const c = canvas.getContext('2d'), main = ctx; ctx = c;
  try {
    const T = MON[type]; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.translate(px / 2, px / 2 + 1);
    const k = SPR[type] ? (px * .92) / ((T.spr || 2.6) * T.r) : (px / 48) * ({ golem: .36, bat: .44, bomb: .5 }[type] || .58);
    c.scale(k, k); drawBody({ type, r: T.r, hr: T.hr || T.r, hp: T.hp, maxHp: T.hp, vx: 0, vy: 0, age: 1, ph: 0, flash: 0 }, .3);
  } finally { ctx = main; }
}
function drawDexIcons() { document.querySelectorAll('canvas[data-mon]').forEach(c => drawIcon(c.dataset.mon, c)); }
(() => {
  for (const [id, size] of [['#dex2', 46]]) {
    const ul = $(id);
    for (const type of ['slime', 'ghost', 'bat', 'golem', 'star', 'bomb']) {
      const li = document.createElement('li'), cvs = document.createElement('canvas'), d = document.createElement('div'), b = document.createElement('b'), s = document.createElement('small');
      cvs.dataset.mon = type; cvs.dataset.size = String(size); b.textContent = MON[type].name; s.textContent = MON[type].desc; d.append(b, s); li.append(cvs, d); ul.appendChild(li);
    }
  }
  drawDexIcons(); renderBoard();
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
  if (m.type === 'bomb') {   // ばくだんは、画像でも「危ない」の赤い輪を必ず出す
    const pulse = .5 + .5 * Math.sin(t * 8 + m.ph);
    ctx.strokeStyle = `rgba(255,77,94,${.35 + .4 * pulse})`; ctx.lineWidth = 4; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -t * 30;
    ctx.beginPath(); ctx.arc(0, 0, m.r + 10 + pulse * 3, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  const img = SPR[m.type];
  if (img) drawSprite(m, t, img);
  else switch (m.type) { case 'slime': drawSlime(m); break; case 'ghost': drawGhost(m, t); break; case 'bat': drawBat(m, t); break; case 'golem': drawGolem(m); break; case 'bomb': drawBombBody(m, t); break; case 'star': drawStar(m, t); break; }
  if (m.type === 'golem') for (let i = 0; i < m.maxHp; i++) { ctx.fillStyle = i < m.hp ? '#ffd24d' : 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc((i - (m.maxHp - 1) / 2) * 16, -m.r * 1.25, 5, 0, TAU); ctx.fill(); }
}
function drawMonster(m, t, alpha = 1) {
  const sp = m.age < .2 ? easeOutBack(m.age / .2) : 1;   // 出てくるとき、ポンとふくらむ
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(m.x, m.y); if (sp !== 1) ctx.scale(sp, sp); drawBody(m, t);
  if (m.flash > 0) { ctx.globalAlpha = alpha * clamp(m.flash / .15, 0, 1) * .65; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, m.r * .95, 0, TAU); ctx.fill(); }
  ctx.restore();
}
function drawGhostRace() {
  if (!ghostOn() || !previousGhost || !previousGhost.length) return;
  if (elapsed > previousGhost[previousGhost.length - 1].t) return;   // 記録の最後を過ぎたら残像を消す
  const sample = sampleGhost(previousGhost, elapsed);
  if (!sample) return;
  const radius = 18;
  ctx.save();
  ctx.globalAlpha = TUNING.ghost.alpha;
  ctx.strokeStyle = TUNING.ghost.color;
  ctx.fillStyle = TUNING.ghost.color;
  ctx.lineWidth = 3;
  ctx.shadowColor = TUNING.ghost.color;
  ctx.shadowBlur = radius;
  for (const point of sample.p) {
    const x = point.x * W, y = point.y * H;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, radius / 4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
function drawBoss() {
  if (!boss || boss.hp <= 0) return;
  const radius = TUNING.boss.radius;
  if (boss.telegraphUntil && elapsed < boss.telegraphUntil) {
    const pulse = .5 + .5 * Math.sin(elapsed * 20);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .5 + .3 * pulse;
    const glow = ctx.createRadialGradient(boss.x, boss.y, 0, boss.x, boss.y, radius * 1.6);
    glow.addColorStop(0, 'rgba(255,255,255,.95)'); glow.addColorStop(1, 'rgba(255,80,40,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(boss.x, boss.y, radius * 1.6, 0, TAU); ctx.fill(); ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = .92;
  ctx.translate(boss.x, boss.y);
  if (SPR.boss) {
    ctx.drawImage(SPR.boss, -radius, -radius, radius * 2, radius * 2);
  } else {
    drawSlime({ r: radius, vx: boss.vx, vy: 0 });
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
function drawHands() {
  ctx.save(); ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const hh of AI.hands) {
    const pts = hh.pts; ctx.globalAlpha = hh.ok ? 1 : .35;
    ctx.strokeStyle = 'rgba(46,242,255,.9)'; ctx.beginPath(); for (const [a, b] of HAND_LINKS) { ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); } ctx.stroke();
    for (let i = 0; i < pts.length; i++) { ctx.fillStyle = i === 8 ? '#ff2e88' : '#fff'; ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, i === 8 ? 7 : 3.5, 0, TAU); ctx.fill(); }
    txt(hh.ok ? '手 21点' : 'とおい手（むし）', pts[0].x, pts[0].y + 26, 13, '#2ef2ff', 'center', 800, FB, { w: 4, c: 'rgba(6,8,24,.8)' }); ctx.globalAlpha = 1;
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
  if (flashRed > 0) { ctx.fillStyle = `rgba(255,40,60,${flashRed * .4})`; ctx.fillRect(0, 0, W, H); }
  if (gestureFlashT > 0) { ctx.fillStyle = `rgba(255,255,255,${(gestureFlashT / TUNING.gesture.flashSec) * .55})`; ctx.fillRect(0, 0, W, H); }
}
// メニューや待機画面のうしろで、ゆっくりただよう飾りのモンスター
function initDeco() {
  deco = []; const types = ['slime', 'ghost', 'bat', 'slime', 'star', 'golem', 'ghost'];
  types.forEach((type, i) => deco.push({ type, r: MON[type].r, hr: MON[type].r, hp: MON[type].hp, maxHp: MON[type].hp, x: rnd(40, W - 40), y: rnd(60, H - 60), vx: rnd(-26, 26), vy: rnd(-16, 16), age: 1, ph: i * 1.7, flash: 0 }));
}
function updateDeco(dt) { for (const m of deco) { m.age += dt; m.x += m.vx * dt + Math.sin(m.age * .7 + m.ph) * 20 * dt; m.y += m.vy * dt + Math.cos(m.age * .6 + m.ph) * 16 * dt; if (m.x < -60) m.x = W + 60; if (m.x > W + 60) m.x = -60; if (m.y < 40 || m.y > H - 40) m.vy *= -1; } }

function drawShields() {
  if (!S.gesture) return;
  for (const g of gestureStates) {
    if (!g.shieldActive) continue;
    const k = clamp(g.shieldTimeLeft / TUNING.gesture.shieldDuration, 0, 1);
    ctx.save(); ctx.globalAlpha = .55 + .2 * Math.sin(performance.now() / 110);
    ctx.strokeStyle = '#4FC3F7'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(g.shieldX, g.shieldY, TUNING.gesture.shieldRadius, 0, TAU); ctx.stroke();
    ctx.globalAlpha *= .25; ctx.fillStyle = '#4FC3F7'; ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(g.shieldX, g.shieldY, TUNING.gesture.shieldRadius + 6, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    ctx.restore();
  }
}
function drawGesturePlayerHud(g, cx, y) {
  const barW = 130, barH = 14, x = cx - barW / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,34,.75)'; rrPath(x, y - barH / 2, barW, barH, 7); ctx.fill();
  const full = g.gauge >= 100;
  ctx.fillStyle = full ? '#fff35e' : '#5dc8ff'; rrPath(x, y - barH / 2, barW * clamp(g.gauge / 100, 0, 1), barH, 7); ctx.fill();
  if (full) { ctx.globalAlpha = .55 + .45 * Math.sin(performance.now() / 130); ctx.strokeStyle = '#fff35e'; ctx.lineWidth = 3; rrPath(x - 2, y - barH / 2 - 2, barW + 4, barH + 4, 8); ctx.stroke(); ctx.globalAlpha = 1; }
  txt('グー', x - 10, y + 5, 13, '#fff', 'right', 800, FB, { w: 4, c: 'rgba(6,8,24,.9)' });

  const sx = cx + barW / 2 + 34, sr = 15;
  ctx.beginPath(); ctx.arc(sx, y, sr, 0, TAU);
  if (g.shieldActive) {
    ctx.fillStyle = 'rgba(79,195,247,.85)'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, y, sr, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(g.shieldTimeLeft / TUNING.gesture.shieldDuration, 0, 1)); ctx.lineTo(sx, y); ctx.stroke();
  } else if (g.shieldCooldownLeft > 0) {
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx, y); ctx.arc(sx, y, sr, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - clamp(g.shieldCooldownLeft / TUNING.gesture.shieldCooldown, 0, 1))); ctx.closePath();
    ctx.fillStyle = 'rgba(79,195,247,.5)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, y, sr, 0, TAU); ctx.stroke();
  } else {
    ctx.strokeStyle = '#4FC3F7'; ctx.lineWidth = 3; ctx.stroke();
  }
  txt('パー', sx + 22, y + 5, 13, '#fff', 'left', 800, FB, { w: 4, c: 'rgba(6,8,24,.9)' });
  ctx.restore();
}
function drawGestureHud() {
  if (!S.gesture || !(state === 'play' || state === 'countdown' || state === 'paused')) return;
  if (S.two && gestureStates.length > 1) { drawGesturePlayerHud(gestureStates[0], W / 4, H - 24); drawGesturePlayerHud(gestureStates[1], W * 3 / 4, H - 24); }
  else drawGesturePlayerHud(gestureStates[0], W / 2, H - 24);
}
// 2人プレイ: 画面のまん中に、左右の境目（どちらにも割り当てない不感帯）をうすく出す
function drawTwoDivider() {
  if (!S.two) return;
  const dz = W * TUNING.two.centerDeadZone;
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(W / 2 - dz / 2, 0, dz, H);
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2; ctx.setLineDash([10, 10]);
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke(); ctx.restore();
}
function render(t) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  let sx = 0, sy = 0;
  if (shake > 0 && !reduceMotion) { sx += rnd(-1, 1) * shake * 9; sy += rnd(-1, 1) * shake * 9; }
  if (gestureShakeT > 0 && !reduceMotion) { const k = gestureShakeT / TUNING.gesture.shakeSec; sx += rnd(-1, 1) * k * TUNING.gesture.shakePx; sy += rnd(-1, 1) * k * TUNING.gesture.shakePx; }
  ctx.save(); ctx.translate(sx, sy);
  drawBackground(t);
  if (state === 'menu' || state === 'loading') { for (const m of deco) drawMonster(m, t, .45); }
  else {
    if (state === 'ready') for (const m of deco) drawMonster(m, t, .22);
    if (runMode === 'motion' && Cam.ready && state !== 'result') Motion.draw(S.eye || state === 'ready' ? .95 : .5);
    if (state !== 'result') drawTwoDivider();
    if (runMode === 'ai' && Cam.ready && (S.eye || state === 'ready' || state === 'countdown')) drawHands();
    if (state !== 'result') drawGhostRace();
    if (state !== 'result') { const fa = state === 'finish' ? clamp(1 - finT / 1.2, 0, 1) : 1; for (const m of monsters) drawMonster(m, t, fa); drawBoss(); for (const s of shots) drawShot(s, t, fa); }
    if (state !== 'result') drawShields();
    drawFx();
    if (state !== 'result' && state !== 'finish') drawTrails(t);
  }
  ctx.restore();
  if (cracks.length) drawCracks();   // ヒビは画面のガラスに入るので、ゆれの外で描く
  drawGestureHud();   // ゲージ・盾のアイコンは、ゆれの外で描く
}

// ============================================================
//  メインループ
// ============================================================
function step(dt, t) {
  frameCount++;
  shown = lerp(shown, score, 1 - Math.pow(.0005, dt));
  shown2 = lerp(shown2, score2, 1 - Math.pow(.0005, dt));
  gridPhase = (gridPhase + dt * (state === 'play' ? 1.6 : .35)) % 1;
  if (shake > 0) shake = Math.max(0, shake - dt * 2.5); if (flashRed > 0) flashRed = Math.max(0, flashRed - dt * 2.2);
  if (gestureFlashT > 0) gestureFlashT = Math.max(0, gestureFlashT - dt); if (gestureShakeT > 0) gestureShakeT = Math.max(0, gestureShakeT - dt);
  if (state !== 'paused') { updateFx(dt); if (cracks.length) { for (const c of cracks) c.life -= dt; cracks = cracks.filter(c => c.life > 0); } }
  const live = state === 'ready' || state === 'countdown' || state === 'play';
  if (live && Cam.ready) {
    if (runMode === 'ai') { for (const p of ptrs) p.miss += dt; aiStep(t, dt); for (const p of ptrs) if (p.active && p.miss > .25) { p.active = false; p.shape = 'none'; } }
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
window.__fs = { S, TUNING, MON, AI, Motion, ptrs, SPR, get state() { return state; }, get mode() { return runMode; }, get score() { return score; }, get combo() { return maxCombo; }, get kills() { return kills; }, get bombs() { return bombs; }, get monsters() { return monsters; }, get timeLeft() { return timeLeft; }, set timeLeft(v) { timeLeft = v; }, get boss() { return boss; }, get bossAppeared() { return bossAppeared; }, get shots() { return shots; }, get reflects() { return reflects; }, get shotHits() { return shotHits; }, get combo2() { return combo; }, get ghostSamples() { return ghostSamples; }, get previousGhost() { return previousGhost; }, get elapsed() { return elapsed; }, launchShot, get feverT() { return feverT; }, spawn, startFlow, updatePlay, testHits, renderBoard, banner, confetti, get gestureStates() { return gestureStates; }, triggerFistBurst, updateGesture,
  get two() { return S.two; }, get p2() { return { score: score2, combo: combo2, maxCombo: maxCombo2, kills: kills2, bombs: bombs2 }; }, playerIndexForPtr, playerIndexForX, scoreOf, maxComboOf, killsOf, bombsOf };
if (qs.get('autostart') === '1') startFlow();
