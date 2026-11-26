const TUNING = {
  roundSeconds: 30,        // 1回のプレイ時間（びょう）
  bombPenaltySeconds: 3,   // ばくだんにさわったときに へる時間（びょう）
  feverSeconds: 8,         // ほしを取ったときの フィーバー時間（びょう）
  comboWindow: 1.4,        // この秒数いないに次をたおすと、コンボがつながる
  maxMonsters: 14,         // 同時に出るモンスターの上限
  boothResultSeconds: 12,  // ブース: けっか画面を出しておく時間（そのあと自動で次の人の待機画面へ）
  boothMinHandPx: 18,      // ブース: これより小さく写った手（うしろに並んでいる人の手）は無視する
  attractPageSeconds: 7,   // 待機画面: ランキング／あそびかた／モンスター を切りかえる間かく
  music: true,             // プレイ中のBGM
  bgmVolume: 0.5,          // BGM（assets/bg.mp3）の音量（0〜1）
  bgmLastRate: 1.1,        // ラスト10びょうで BGM を何倍の速さにするか（1 なら変えない）
  // 手の追いかけ方（ずれが気になるときはここを調整）
  ai: {
    pipelineMs: 40,     // カメラ→AIまでの、測れない遅れの見込み（ミリ秒）。点が手より遅れるなら大きく、行きすぎるなら小さく
    maxLead: 0.12,      // 先読みする時間の上限（秒）
    maxLeadPx: 90,      // 先読みで動かす距離の上限（画面ピクセル）。急に向きを変えたときの行きすぎを防ぐ
    smoothMin: 0.35,    // 止めているときの追従の強さ（小さいほど なめらか、遅れやすい）
    smoothMax: 0.95,    // 速く動かしたときの追従の強さ（1に近いほど そのまま）
    smoothDist: 40,     // この距離（ピクセル）動くと追従が強くなる
  },
  attacks: {               // てきの攻撃（火の玉）。スタッフメニューの「てきの攻撃」でオン・オフ
    startAfter: 6,         // ゲーム開始から何びょう後に、攻撃が始まるか
    interval: { easy: [5, 7], normal: [3.5, 5.5], hard: [2.5, 4], extreme: [1.3, 2.2] },   // 攻撃と攻撃の間かく（びょう）
    windup: 0.6,           // 投げる前の「ため」（頭の上に ! が出る時間）
    flyTime: { easy: 2.2, normal: 1.8, hard: 1.4, extreme: 1.15 },  // 火の玉がとどくまでの時間（長いほど、はじきやすい）
    penaltySeconds: 2,     // 当たったとき へる時間（びょう）
    reflectPts: 30,        // はじき返したときの点数（コンボ倍率がかかる）
    maxAtOnce: { easy: 2, normal: 2, hard: 2, extreme: 4 },   // 同時に飛んでくる火の玉の上限
    volley: { extreme: 2 },   // 1回の攻撃で投げてくる火の玉の数（書いていない難易度は1こ）
  },
  boss: {
    appearAt: 5,
    hp: 150,
    damage: 10,
    hitCooldown: 0.12,
    minSpeed: 220,
    bonus: 500,
    radius: 96,
    moveSpeed: 150,        // ふだんの速さ（px/びょう）
    startAngle: 0.35,
    dashSpeed: 560,        // ダッシュした直後の速さ（px/びょう）
    dashInterval: [0.8, 1.4],   // ダッシュの間かく（びょう）
    firstDash: 0.3,        // 登場してから最初のダッシュまで（びょう）
    dashDecay: 3,          // ダッシュのあと減速する早さ（大きいほどすぐ遅くなる）
    wobble: 1.6,           // くねくね曲がる強さ
    wobbleFreq: 1.3,       // くねくねの速さ（1びょうに何回）
    rage: 0.6,             // HPが0に近づくと、速さとダッシュの回数が最大 1+この値 倍になる
    hitDashDelay: 0.12,    // 斬られてから逃げるダッシュまでの時間（びょう）
    centerY: 260,
    maxMonsters: 6,
    barHeight: 10,
    barOffset: 18,
    color: '#5dff9a',
  },
  ghost: {
    interval: 0.1,
    maxDuration: 180,
    maxSamples: 1801,
    maxBytes: 48 * 1024,
    radius: 18,
    opacity: 0.42,
    color: '#65f5ff',
  },
  difficulty: {            // spawn:出る間かく(小さいほど多い) speed:速さ bomb:ばくだんの出やすさ pad:当たりの広さ(px) maxBombs:同時に出るばくだんの上限
    easy:    { spawn: 1.00, speed: 0.85, bomb: 0.05, pad: 24, maxBombs: 2 },
    normal:  { spawn: 0.80, speed: 1.00, bomb: 0.09, pad: 15, maxBombs: 2 },
    hard:    { spawn: 0.62, speed: 1.20, bomb: 0.14, pad: 9,  maxBombs: 2 },
    extreme: { spawn: 0.48, speed: 1.35, bomb: 0.26, pad: 6,  maxBombs: 4 },   // 激ムズ
  },
  comeback: {              // 逆転ゲージ: ばくだん・火の玉に当たるとたまり、満タンで「逆転タイム」
    difficulties: ['extreme'],   // 逆転ゲージを使う難易度
    gaugeMax: 3,           // 何回当たると満タンになるか
    seconds: 6,            // 逆転タイムの長さ（びょう）
    mult: 2,               // 逆転タイム中の得点の倍率（コンボ・フィーバーとかけ算）
    timeBonus: 3,          // 逆転タイムが始まったときに もどる時間（びょう）
    bombPts: 60,           // 金のばくだんをさわったときの点数（倍率がかかる）
    blastRadius: 170,      // 金のばくだんの爆発で、まとめてたおせる広さ（px）
  },
};
// モンスターのデータ（pts: 点数, hp: たおすまでに必要な回数, spr: 画像にしたときの大きさ）
const CALLS = [[5, 'GOOD!', 'c1'], [10, 'GREAT!', 'c2'], [20, 'EXCELLENT!', 'c3'], [30, 'AMAZING!', 'c4'], [50, 'LEGEND!', 'c5']];
const TIPS = [
  'TIPS：手のひらをカメラに向けると、AIが見つけやすいよ',
  'TIPS：つづけてたおすとコンボ！ 5コンボごとに得点アップ',
  `TIPS：ほしをとると FEVER！ ${TUNING.feverSeconds}びょう間 得点2倍`,
  'TIPS：ゴーレムは3回あてると100点',
  `TIPS：ばくだんにさわると、時間が${TUNING.bombPenaltySeconds}びょうへるよ`,
];

// ---- AIの読み込み先（先に ./vendor/ を試し、だめなら公式CDN）----
const MP_VERSION = '1.2.2';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URLS = [
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
];

export { TUNING, CALLS, TIPS, MP_VERSION, CDN, MODEL_URLS };
