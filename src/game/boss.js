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
    speed: tuning.moveSpeed,
    vx: Math.cos(angle) * tuning.moveSpeed,
    vy: Math.sin(angle) * tuning.moveSpeed,
    dashTimer: tuning.firstDash,
    hitCooldown: 0,
    age: 0,
  };
}

// HPが減るほど怒って、速く・せわしなく動く（1 = 怒っていない）
export function bossRage(boss, tuning) {
  return 1 + tuning.rage * (1 - boss.hp / boss.maxHp);
}

// ボスの動き: くねくね進みながら、ときどき画面のどこかへ一気にダッシュする。ダッシュのあとは少しずつ減速する
export function updateBoss(boss, deltaSeconds, tuning, arenaWidth, arenaHeight, random = Math.random) {
  if (!boss || boss.hp <= 0) return;
  const dt = deltaSeconds, rage = bossRage(boss, tuning), base = tuning.moveSpeed * rage;
  const left = tuning.radius, right = arenaWidth - tuning.radius;
  const top = tuning.radius, bottom = arenaHeight - tuning.radius;
  boss.age += dt;
  boss.hitCooldown = Math.max(0, boss.hitCooldown - dt);
  boss.dashTimer -= dt;
  if (boss.dashTimer <= 0) {
    const [a, b] = tuning.dashInterval;
    boss.dashTimer = (a + (b - a) * random()) / rage;
    const tx = left + (right - left) * random(), ty = top + (bottom - top) * random();   // 画面のどこかをめざす
    boss.heading = Math.atan2(ty - boss.y, tx - boss.x);
    boss.speed = tuning.dashSpeed * rage;
  }
  boss.speed = base + (boss.speed - base) * Math.exp(-tuning.dashDecay * dt);
  boss.heading += Math.sin(boss.age * Math.PI * 2 * tuning.wobbleFreq) * tuning.wobble * dt;   // くねくね
  boss.vx = Math.cos(boss.heading) * boss.speed;
  boss.vy = Math.sin(boss.heading) * boss.speed;

  boss.x += boss.vx * dt;
  boss.y += boss.vy * dt;
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

  return applyBossDamage(boss, tuning.damage, tuning);
}

// 必殺技（グー）: 斬る速さやクールタイムに関係なく、大きなダメージを与える
export function punchBoss(boss, damage, tuning) {
  if (!boss || boss.hp <= 0) return { applied: false, defeated: false, bonus: 0, damage: 0 };
  return applyBossDamage(boss, damage, tuning);
}

function applyBossDamage(boss, damage, tuning) {
  const dealt = Math.min(boss.hp, damage);
  boss.hp = Math.max(0, boss.hp - damage);
  boss.hitCooldown = tuning.hitCooldown;
  boss.dashTimer = Math.min(boss.dashTimer, tuning.hitDashDelay);   // 斬られたら、すぐ逃げる
  const defeated = boss.hp === 0;
  return { applied: true, defeated, bonus: defeated ? tuning.bonus : 0, damage: dealt };
}
