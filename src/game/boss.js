export function shouldSpawnBoss(enabled, alreadyAppeared, timeLeft, appearAt) {
  return enabled && !alreadyAppeared && timeLeft <= appearAt;
}

export function createBoss(tuning, arenaWidth) {
  const angle = tuning.startAngle;
  return {
    x: arenaWidth / 2,
    y: tuning.centerY,
    hp: tuning.hp,
    maxHp: tuning.hp,
    heading: angle,
    vx: Math.cos(angle) * tuning.moveSpeed,
    vy: Math.sin(angle) * tuning.moveSpeed,
    turnTimer: tuning.turnInterval,
    hitCooldown: 0,
  };
}

export function updateBoss(boss, deltaSeconds, tuning, arenaWidth, arenaHeight) {
  if (!boss || boss.hp <= 0) return;
  boss.hitCooldown = Math.max(0, boss.hitCooldown - deltaSeconds);
  boss.turnTimer -= deltaSeconds;
  while (boss.turnTimer <= 0) {
    boss.heading += tuning.turnAngle;
    boss.vx = Math.cos(boss.heading) * tuning.moveSpeed;
    boss.vy = Math.sin(boss.heading) * tuning.moveSpeed;
    boss.turnTimer += tuning.turnInterval;
  }

  const left = tuning.radius, right = arenaWidth - tuning.radius;
  const top = tuning.radius, bottom = arenaHeight - tuning.radius;
  boss.x += boss.vx * deltaSeconds;
  boss.y += boss.vy * deltaSeconds;
  let bounced = false;
  if (boss.x >= right) { boss.x = right; boss.vx = -Math.abs(boss.vx); bounced = true; }
  else if (boss.x <= left) { boss.x = left; boss.vx = Math.abs(boss.vx); bounced = true; }
  if (boss.y >= bottom) { boss.y = bottom; boss.vy = -Math.abs(boss.vy); bounced = true; }
  else if (boss.y <= top) { boss.y = top; boss.vy = Math.abs(boss.vy); bounced = true; }
  if (bounced) boss.heading = Math.atan2(boss.vy, boss.vx);
}

export function damageBoss(boss, speed, tuning) {
  if (!boss || boss.hp <= 0 || speed < tuning.minSpeed || boss.hitCooldown > 0) {
    return { applied: false, defeated: false, bonus: 0 };
  }

  boss.hp = Math.max(0, boss.hp - tuning.damage);
  boss.hitCooldown = tuning.hitCooldown;
  const defeated = boss.hp === 0;
  return { applied: true, defeated, bonus: defeated ? tuning.bonus : 0 };
}
