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
    interval: { easy: [5, 7], normal: [3.5, 5.5], hard: [2.5, 4] },   // 攻撃と攻撃の間かく（びょう）
    windup: 0.6,           // 投げる前の「ため」（頭の上に ! が出る時間）
    flyTime: { easy: 2.2, normal: 1.8, hard: 1.4 },    // 火の玉がとどくまでの時間（長いほど、はじきやすい）
    penaltySeconds: 2,     // 当たったとき へる時間（びょう）
    reflectPts: 30,        // はじき返したときの点数（コンボ倍率がかかる）
    maxAtOnce: 2,          // 同時に飛んでくる火の玉の上限
  },
  boss: {
    appearAt: { 30: 5, 60: 15 },     // 残り時間がこの秒数以下になったら登場（プレイ時間ごと）
    hp: { 30: 150, 60: 300 },        // 体力（プレイ時間ごと）
    radius: 96,
    yRatio: 0.28,                    // 画面の上から何割の高さに出るか
    shotInterval: 3,                 // 火の玉を出す間かく（びょう）。出現+3, +6…
    telegraph: 0.6,                  // 火の玉が出る何びょう前から光って「！」を出すか
    maxShots: 2,                     // ボスの火の玉が同時に飛べる上限
    reflectDamage: 30,               // はね返した火の玉が当たったときのダメージ
    slashDamage: 10,                 // 斬りが当たったときのダメージ
    slashCooldown: 0.12,             // 同じ人の斬りダメージが連続で入るまでの間かく（びょう）
    minSlashSpeed: 220,              // これより速い斬りだけ有効（px/びょう）
    defeatBonus: 500,                // 撃破したときのボーナス点（コンボ倍率なし）
    moveSpeed: 60,                   // 左右に動く速さ
    moveSpeedBoost: 1.35,            // 中盤の左右移動の速度倍率
    moveSpeedRush: 1.7,              // 残り体力が少ないときの速度倍率
    yWaveAmplitude: 30,              // 中盤の上下うごきの大きさ
    yWaveRushAmplitude: 55,          // 終盤の上下うごきの大きさ
    phaseMidRatio: 0.66,             // この残りHP比率以下でジグザグフェーズ
    phaseRushRatio: 0.33,            // この残りHP比率以下で高速フェーズ
    moveMargin: 140,                 // 画面の左右の端から、これだけ内側を往復する
    maxMonsters: 6,                  // ボスがいる間の、通常モンスターの上限
    barHeight: 10,
    barOffset: 18,
    color: '#5dff9a',
  },
  ghost: {
    interval: 0.1,     // 前の記録から何びょう以上たつたびに記録するか
    alpha: 0.35,       // 残像のうすさ
    color: '#4FC3F7',
  },
  gesture: {
    gaugeEnemy: 10,       // 通常の敵を1体たおすごとに増えるゲージ（%）
    gaugeBossHit: 2,      // ボスへ斬りダメージが入るごとに増えるゲージ（%）
    fistFingers: 3,       // グーと判定する、曲がっている指の本数
    fistHold: 0.5,        // ゲージ100%でグーの形をこの秒数続けると発動
    fistBossDamage: 30,   // グー発動時のボスへのダメージ
    openHold: 0.3,        // パーの形をこの秒数続けると、盾が発動
    shieldDuration: 2,    // 盾が出ている時間（びょう）
    shieldCooldown: 8,    // 盾の再使用までの時間（びょう）。発動の瞬間から数える
    shieldRadius: 120,    // 盾の半径
    graceMs: 120,         // 形が崩れても、この時間以内なら保持が続いているとみなす
    flashSec: 0.25,       // グー発動時、画面が光る時間
    shakeSec: 0.4,        // グー発動時、画面がゆれる時間
    shakePx: 12,          // グー発動時の、画面のゆれの大きさ
  },
  two: {
    duration: 60,         // 2人プレイのプレイ時間（びょう）に固定
    maxHands: 4,          // 2人プレイのときにAIへ渡す手の数
    centerDeadZone: 0.04, // 画面の中央、左右どちらにも割り当てない範囲（幅に対する割合）
  },
  difficulty: {            // spawn:出る間かく(小さいほど多い) speed:速さ bomb:ばくだんの出やすさ pad:当たりの広さ(px)
    easy:   { spawn: 1.00, speed: 0.85, bomb: 0.05, pad: 24 },
    normal: { spawn: 0.80, speed: 1.00, bomb: 0.09, pad: 15 },
    hard:   { spawn: 0.62, speed: 1.20, bomb: 0.14, pad: 9  },
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
