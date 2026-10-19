type RewardTierLike = {
  minScore: number;
  title: string;
};

/** Числа механики. Контент (тексты, состав заданий) живёт в конфигурации, правила подсчёта — здесь. */
export const SCORING = {
  tasksPerRoom: 3,
  fusesPerRoom: 3,
  comboStep: 25,
  comboCap: 75,
  noFailBonus: 50,
  speedWindowSeconds: 75,
  speedMultiplier: 2,
  rushHitPoints: 20,
  /** Сколько верных заявок рывка считается достижимым максимумом при расчёте порогов в процентах. */
  rushPlannedHits: 15
} as const;

/** Серия подряд идущих заданий на 100 после очередного ответа. */
export function nextCombo(previousCombo: number, base: number): number {
  return base === 100 ? previousCombo + 1 : 0;
}

/** Бонус за задание: 25 × (комбо − 1), не больше 75; первое задание серии бонуса не даёт. */
export function comboBonus(combo: number): number {
  if (combo < 2) return 0;
  return Math.min(SCORING.comboCap, SCORING.comboStep * (combo - 1));
}

/** «Предохранители» комнаты: каждое задание на 0 отнимает один из трёх. */
export function fusesLeft(bases: number[]): number {
  const failures = bases.filter((base) => base === 0).length;
  return Math.max(0, SCORING.fusesPerRoom - failures);
}

/** +50 за комнату без нулевых заданий; только для полностью пройденной комнаты. */
export function noFailBonus(bases: number[], tasksInRoom: number = SCORING.tasksPerRoom): number {
  if (bases.length < tasksInRoom) return 0;
  return bases.some((base) => base === 0) ? 0 : SCORING.noFailBonus;
}

/** Целые секунды (в меньшую сторону) в промежутке в миллисекундах; отрицательный промежуток считается нулём. */
export function elapsedSeconds(durationMs: number): number {
  return Math.max(0, Math.floor(durationMs / 1000));
}

/**
 * Бонус скорости комнаты: max(0, 75 − секунды) × 2 × (база комнаты / 300), округление вниз.
 * Умножение на долю базы не даёт заработать «скорость» на ошибках.
 */
export function speedBonus(seconds: number, roomBase: number, tasksInRoom: number = SCORING.tasksPerRoom): number {
  const full = Math.max(0, SCORING.speedWindowSeconds - seconds) * SCORING.speedMultiplier;
  return Math.floor((full * roomBase) / (tasksInRoom * 100));
}

export type RoomAnswerFacts = {
  base: number;
  comboBonus: number;
  /** Время задания: от первой выдачи сервером до ответа; чтение разбора сюда не входит. */
  durationMs: number;
};

export type RoomSummary = {
  roomId: string;
  answered: number;
  completed: boolean;
  base: number;
  comboBonus: number;
  fuses: number;
  noFailBonus: number;
  speedBonus: number;
  elapsedSeconds: number | null;
  total: number;
};

/**
 * Итог комнаты по её ответам (в порядке ответов).
 * Бонусы «без сбоев» и скорости начисляются только за ответ на все задания комнаты;
 * время комнаты — сумма времени её заданий.
 */
export function summarizeRoom(
  roomId: string,
  answers: RoomAnswerFacts[],
  tasksInRoom: number = SCORING.tasksPerRoom
): RoomSummary {
  const bases = answers.map((answer) => answer.base);
  const completed = answers.length >= tasksInRoom;
  const base = bases.reduce((sum, value) => sum + value, 0);
  const combo = answers.reduce((sum, answer) => sum + answer.comboBonus, 0);
  const noFail = completed ? noFailBonus(bases, tasksInRoom) : 0;
  const seconds = completed
    ? elapsedSeconds(answers.reduce((sum, answer) => sum + Math.max(0, answer.durationMs), 0))
    : null;
  const speed = seconds === null ? 0 : speedBonus(seconds, base, tasksInRoom);
  return {
    roomId,
    answered: answers.length,
    completed,
    base,
    comboBonus: combo,
    fuses: fusesLeft(bases),
    noFailBonus: noFail,
    speedBonus: speed,
    elapsedSeconds: seconds,
    total: base + combo + noFail + speed
  };
}

/** Очки рывка: +20 за каждый верный ответ. */
export function rushPoints(hits: number): number {
  return hits * SCORING.rushHitPoints;
}

/**
 * Максимум очков кампании при идеальной игре: все задания на 100, комбо сквозь комнаты,
 * «без сбоев» и мгновенная скорость в каждой комнате, плановое число верных заявок рывка.
 * От него считаются пороги призовых уровней в процентах (`minPercent`).
 */
export function maxScore(tasksPerRoom: number[], rushHits: number = SCORING.rushPlannedHits): number {
  const taskCount = tasksPerRoom.reduce((sum, count) => sum + count, 0);
  let total = taskCount * 100;
  for (let order = 1; order <= taskCount; order += 1) {
    total += comboBonus(order);
  }
  // Скорость при нуле секунд: полное окно × множитель при полной базе комнаты.
  total += tasksPerRoom.length * (SCORING.noFailBonus + SCORING.speedWindowSeconds * SCORING.speedMultiplier);
  return total + rushPoints(rushHits);
}

export function totalScore(rooms: RoomSummary[], rushHits: number): number {
  return rooms.reduce((sum, room) => sum + room.total, 0) + rushPoints(rushHits);
}

export function resolveReward<T extends RewardTierLike>(score: number, tiers: T[]): T {
  if (!Number.isInteger(score) || score < 0) {
    throw new Error("Score must be a non-negative integer");
  }

  const ordered = [...tiers].sort((left, right) => left.minScore - right.minScore);
  const resolved = ordered.filter((tier) => tier.minScore <= score).at(-1);
  if (!resolved) {
    throw new Error(`No reward tier configured for score ${score}`);
  }

  return resolved;
}
