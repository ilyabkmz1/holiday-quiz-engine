export type StreakGoal = { opened: number; rewardId: string };

export type StreakPolicy = {
  /** День 0 «Подарок за старт»: учитывается в прогрессе, но не в серии. */
  endowedDay: boolean;
  /** Сколько пропусков серия переживает. */
  freezes: number;
  goals: readonly StreakGoal[];
};

/** Открытие двери: номер дня и открыт ли он вовремя (в сам день), а не догнан позже. */
export type OpenedDay = { day: number; onTime: boolean };

export type StreakState = {
  current: number;
  best: number;
  freezesUsed: number;
  freezesLeft: number;
  comebackEligible: boolean;
  /** Открыто дверей (вовремя и догнанных) плюс подаренный день. */
  progress: number;
  goalsReached: StreakGoal[];
  nextGoal: StreakGoal | null;
};

/**
 * Состояние серии и прогресса на день `today` (`dayIndexAt`; `null` до старта).
 *
 * Правила:
 * 1. В серию идут только двери, открытые вовремя, то есть в сам день. Догнанный день в серию не входит.
 * 2. Прошедший день без открытия вовремя («пропуск») тратит одну заморозку, если серия идёт (`current > 0`) и
 *    заморозки остались: серия сохраняется, но этот день её не удлиняет. Иначе серия обнуляется (если она уже
 *    нулевая, ничего не тратится).
 * 3. Сегодняшний день, пока он не открыт, пропуском не считается: успеть можно до конца дня.
 *    Открытый вовремя сегодняшний день удлиняет серию.
 * 4. `best` — максимум `current` за всё время.
 * 5. `progress` = число разных открытых дней (вовремя или догнанных) плюс 1 за подаренный день, если он включён.
 *    По нему считаются цели: `goalsReached` — цели с `opened <= progress` по возрастанию, `nextGoal` — ближайшая
 *    недостигнутая или `null`.
 * 6. `comebackEligible` — бонус за возвращение: серия реально прервана, то есть вчерашний день пропущен без
 *    заморозки и `current` равен 0; сегодня дверь ещё не открыта, а раньше игрок уже открывал хотя бы один день.
 *    Если пропуск закрыла заморозка (даже последняя), серия жива и бонуса нет. Тот, кто пришёл впервые,
 *    не «возвращается».
 */
export function streakState(opened: readonly OpenedDay[], today: number | null, policy: StreakPolicy): StreakState {
  const byDay = new Map<number, boolean>();
  for (const entry of opened) byDay.set(entry.day, (byDay.get(entry.day) ?? false) || entry.onTime);

  let current = 0;
  let best = 0;
  let freezesUsed = 0;
  let yesterday: "ontime" | "frozen" | "broken" | null = null;

  const lastClosed = today === null ? 0 : today - 1;
  for (let day = 1; day <= lastClosed; day += 1) {
    if (byDay.get(day) === true) {
      current += 1;
      best = Math.max(best, current);
      yesterday = "ontime";
    } else if (current > 0 && freezesUsed < policy.freezes) {
      freezesUsed += 1;
      yesterday = "frozen";
    } else {
      current = 0;
      yesterday = "broken";
    }
  }
  if (today !== null && byDay.get(today) === true) {
    current += 1;
    best = Math.max(best, current);
  }

  const freezesLeft = policy.freezes - freezesUsed;
  const progress = byDay.size + (policy.endowedDay ? 1 : 0);
  const goals = [...policy.goals].sort((a, b) => a.opened - b.opened);
  const openedBefore = [...byDay.keys()].some((day) => today === null || day < today);
  const comebackEligible = today !== null && !byDay.has(today) && openedBefore && yesterday === "broken";

  return {
    current,
    best,
    freezesUsed,
    freezesLeft,
    comebackEligible,
    progress,
    goalsReached: goals.filter((goal) => goal.opened <= progress),
    nextGoal: goals.find((goal) => goal.opened > progress) ?? null
  };
}
