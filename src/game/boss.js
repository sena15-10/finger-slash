export function shouldSpawnBoss(enabled, alreadyAppeared, timeLeft, appearAt) {
  return enabled && !alreadyAppeared && timeLeft <= appearAt;
}

export function createBoss(tuning, hp, arenaWidth, arenaHeight, appearedAt) {
  const baseY = arenaHeight * tuning.yRatio;
  return {
    x: arenaWidth / 2,
    y: baseY,
    baseY,
    motionTime: 0,
    phase: 'patrol',
    pendingPattern: 'single',
    dashPhase: 0,
    hp,
    maxHp: hp,
    vx: tuning.moveSpeed,
    appearedAt,
    shotIndex: 0,
    shotResolvedUntil: 0,
    telegraphUntil: 0,
    cooldowns: {},
  };
}

export function updateBoss(boss, deltaSeconds, tuning, arenaWidth, arenaHeight) {
  if (!boss || boss.hp <= 0) return;
  if (boss.cooldowns) {
    for (const key in boss.cooldowns) boss.cooldowns[key] = Math.max(0, boss.cooldowns[key] - deltaSeconds);
  }
  boss.motionTime = (boss.motionTime || 0) + deltaSeconds;
  boss.baseY = boss.baseY ?? (arenaHeight ?? 540) * tuning.yRatio;
  const hpRatio = boss.maxHp ? boss.hp / boss.maxHp : 1;
  const midRatio = tuning.phaseMidRatio ?? 0.66;
  const rushRatio = tuning.phaseRushRatio ?? 0.33;
  boss.phase = hpRatio <= rushRatio ? 'rush' : hpRatio <= midRatio ? 'zigzag' : 'patrol';

  const speedMultiplier = boss.phase === 'rush'
    ? (tuning.moveSpeedRush ?? 1.7)
    : boss.phase === 'zigzag'
      ? (tuning.moveSpeedBoost ?? 1.35)
      : 1;
  boss.x += boss.vx * speedMultiplier * deltaSeconds;
  const left = tuning.moveMargin, right = arenaWidth - tuning.moveMargin;
  if (boss.x >= right) { boss.x = right; boss.vx = -Math.abs(boss.vx); }
  else if (boss.x <= left) { boss.x = left; boss.vx = Math.abs(boss.vx); }

  if (boss.phase === 'patrol') {
    boss.y = boss.baseY;
  } else if (boss.phase === 'zigzag') {
    boss.y = boss.baseY + Math.sin(boss.motionTime * 2.2) * (tuning.yWaveAmplitude ?? 30);
  } else {
    boss.y = boss.baseY + Math.sin(boss.motionTime * 3.8) * (tuning.yWaveRushAmplitude ?? 55);
  }
}

// 出現から shotInterval びょうごとに1回、火の玉の発射を予定する。
// telegraph びょう前になったら 'launch' を返す（呼び出し側が、その時点でボスの火の玉を作る）。
// 同時に出ているボスの火の玉が maxShots 以上のときは、その回を飛ばして次の周期にまわす。
export function updateBossShots(boss, elapsed, tuning, activeBossShotCount) {
  if (!boss || boss.hp <= 0) return null;
  if (boss.shotResolvedUntil && elapsed < boss.shotResolvedUntil) return null;
  const fireTime = boss.appearedAt + tuning.shotInterval * (boss.shotIndex + 1);
  const telegraphStart = fireTime - tuning.telegraph;
  if (elapsed < telegraphStart) return null;
  boss.shotIndex++;
  boss.shotResolvedUntil = fireTime;
  if (activeBossShotCount >= tuning.maxShots) { boss.telegraphUntil = 0; return null; }
  boss.telegraphUntil = fireTime;
  const hpRatio = boss.maxHp ? boss.hp / boss.maxHp : 1;
  boss.pendingPattern = hpRatio <= (tuning.phaseRushRatio ?? 0.33)
    ? 'triple'
    : hpRatio <= (tuning.phaseMidRatio ?? 0.66)
      ? 'double'
      : 'single';
  return 'launch';
}

function applyDamage(boss, amount, bonus) {
  boss.hp = Math.max(0, boss.hp - amount);
  const defeated = boss.hp === 0;
  return { applied: true, defeated, bonus: defeated ? bonus : 0 };
}

// 斬りダメージ: 速さとクールダウン（プレイヤーごと）を見る
export function damageBoss(boss, speed, tuning, playerId = 'p1') {
  if (!boss || boss.hp <= 0 || speed < tuning.minSlashSpeed) return { applied: false, defeated: false, bonus: 0 };
  boss.cooldowns = boss.cooldowns || {};
  if ((boss.cooldowns[playerId] || 0) > 0) return { applied: false, defeated: false, bonus: 0 };
  boss.cooldowns[playerId] = tuning.slashCooldown;
  return applyDamage(boss, tuning.slashDamage, tuning.defeatBonus);
}

// はね返した火の玉が当たったときのダメージ: 速さ・クールダウンは見ない
export function reflectDamageBoss(boss, tuning) {
  if (!boss || boss.hp <= 0) return { applied: false, defeated: false, bonus: 0 };
  return applyDamage(boss, tuning.reflectDamage, tuning.defeatBonus);
}

// グーの全体攻撃など、固定量のダメージを与えるとき用
export function damageBossFlat(boss, amount, tuning) {
  if (!boss || boss.hp <= 0) return { applied: false, defeated: false, bonus: 0 };
  return applyDamage(boss, amount, tuning.defeatBonus);
}

// 結果画面の「ボスのHP 残り◯%」。残り1でも0%にならないよう、切り上げる
export function bossHpPercent(boss) {
  if (!boss || !boss.maxHp) return 0;
  return Math.ceil(Math.max(0, boss.hp) / boss.maxHp * 100);
}
