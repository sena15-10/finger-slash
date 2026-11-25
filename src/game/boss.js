export function shouldSpawnBoss(enabled, alreadyAppeared, timeLeft, appearAt) {
  return enabled && !alreadyAppeared && timeLeft <= appearAt;
}

export function createBoss(tuning, arenaWidth) {
  return {
    x: arenaWidth / 2,
    y: tuning.centerY,
    hp: tuning.hp,
    maxHp: tuning.hp,
    direction: 1,
    hitCooldown: 0,
  };
}

export function updateBoss(boss, deltaSeconds, tuning, arenaWidth) {
  if (!boss || boss.hp <= 0) return;
  boss.hitCooldown = Math.max(0, boss.hitCooldown - deltaSeconds);
  const left = tuning.radius;
  const right = arenaWidth - tuning.radius;
  const nextX = boss.x + boss.direction * tuning.moveSpeed * deltaSeconds;
  if (nextX >= right) {
    boss.x = right;
    boss.direction = -1;
  } else if (nextX <= left) {
    boss.x = left;
    boss.direction = 1;
  } else {
    boss.x = nextX;
  }
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
