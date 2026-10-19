import { describe, expect, it } from "vitest";

import { streakState, type OpenedDay, type StreakPolicy } from "@/domain/advent/streak";

const policy = (overrides: Partial<StreakPolicy> = {}): StreakPolicy => ({
  endowedDay: false,
  freezes: 0,
  goals: [],
  ...overrides
});
const onTime = (...days: number[]): OpenedDay[] => days.map((day) => ({ day, onTime: true }));
const late = (...days: number[]): OpenedDay[] => days.map((day) => ({ day, onTime: false }));

describe("streakState: серия", () => {
  it("до старта всё по нулям", () => {
    expect(streakState([], null, policy())).toMatchObject({ current: 0, best: 0, progress: 0, comebackEligible: false });
  });

  it("считает подряд открытые вовремя дни, включая сегодняшний", () => {
    expect(streakState(onTime(1, 2, 3), 3, policy())).toMatchObject({ current: 3, best: 3 });
  });

  it("сегодняшний неоткрытый день серию не рвёт", () => {
    expect(streakState(onTime(1, 2), 3, policy())).toMatchObject({ current: 2, best: 2, freezesUsed: 0 });
  });

  it("пропуск без заморозок обрывает серию, best сохраняется", () => {
    const state = streakState(onTime(1, 2, 4, 5), 5, policy());
    expect(state).toMatchObject({ current: 2, best: 2 });
    expect(streakState(onTime(1, 2, 3, 5), 5, policy())).toMatchObject({ current: 1, best: 3 });
  });

  it("пропуск тратит заморозку: серия сохраняется, но день её не удлиняет", () => {
    const state = streakState(onTime(1, 2, 4), 4, policy({ freezes: 1 }));
    expect(state).toMatchObject({ current: 3, best: 3, freezesUsed: 1, freezesLeft: 0 });
  });

  it("вторая пропущенная подряд, когда заморозок уже нет, рвёт серию", () => {
    const state = streakState(onTime(1, 2, 5), 5, policy({ freezes: 1 }));
    expect(state).toMatchObject({ current: 1, best: 2, freezesUsed: 1, freezesLeft: 0 });
  });

  it("заморозка не тратится, если серии ещё нет", () => {
    const state = streakState(onTime(3), 3, policy({ freezes: 2 }));
    expect(state).toMatchObject({ current: 1, freezesUsed: 0, freezesLeft: 2 });
  });

  it("догнанный день не входит в серию и считается пропуском для неё", () => {
    const state = streakState([...onTime(1, 3), ...late(2)], 3, policy());
    expect(state).toMatchObject({ current: 1, best: 1, progress: 3 });
    const frozen = streakState([...onTime(1, 3), ...late(2)], 3, policy({ freezes: 1 }));
    expect(frozen).toMatchObject({ current: 2, freezesUsed: 1 });
  });

  it("повторная запись дня: onTime побеждает", () => {
    expect(streakState([...late(1), ...onTime(1)], 1, policy())).toMatchObject({ current: 1, progress: 1 });
  });
});

describe("streakState: прогресс и цели", () => {
  const goals = [
    { opened: 8, rewardId: "final" },
    { opened: 3, rewardId: "mid" }
  ];

  it("подаренный день входит в прогресс, но не в серию", () => {
    const state = streakState(onTime(1), 1, policy({ endowedDay: true }));
    expect(state).toMatchObject({ progress: 2, current: 1, best: 1 });
    expect(streakState([], 1, policy({ endowedDay: true }))).toMatchObject({ progress: 1, current: 0 });
  });

  it("догнанные дни идут в прогресс", () => {
    expect(streakState([...onTime(4), ...late(1, 2)], 4, policy())).toMatchObject({ progress: 3, current: 1 });
  });

  it("цели упорядочены по возрастанию, nextGoal — ближайшая", () => {
    const none = streakState(onTime(1), 1, policy({ goals }));
    expect(none.goalsReached).toEqual([]);
    expect(none.nextGoal).toEqual({ opened: 3, rewardId: "mid" });

    const mid = streakState(onTime(1, 2), 2, policy({ goals, endowedDay: true }));
    expect(mid.goalsReached).toEqual([{ opened: 3, rewardId: "mid" }]);
    expect(mid.nextGoal).toEqual({ opened: 8, rewardId: "final" });
  });

  it("все цели достигнуты: nextGoal = null", () => {
    const state = streakState(onTime(1, 2, 3, 4, 5, 6, 7, 8), 8, policy({ goals }));
    expect(state.goalsReached.map((goal) => goal.rewardId)).toEqual(["mid", "final"]);
    expect(state.nextGoal).toBeNull();
  });

  it("не изменяет переданную политику", () => {
    const input = policy({ goals });
    streakState(onTime(1), 1, input);
    expect(input.goals).toEqual(goals);
  });
});

describe("streakState: бонус за возвращение", () => {
  it("вчера пропущен и серия оборвана, сегодня не открыто, раньше играл — бонус положен", () => {
    expect(streakState(onTime(1, 2), 4, policy()).comebackEligible).toBe(true);
  });

  it("после открытия сегодняшнего дня бонус пропадает", () => {
    expect(streakState(onTime(1, 2, 4), 4, policy()).comebackEligible).toBe(false);
  });

  it("вчера открыт — бонуса нет", () => {
    expect(streakState(onTime(1, 2, 3), 4, policy()).comebackEligible).toBe(false);
  });

  it("пропуск закрыт заморозкой, и заморозки ещё есть — бонуса нет", () => {
    expect(streakState(onTime(1, 2), 4, policy({ freezes: 2 })).comebackEligible).toBe(false);
  });

  it("пропуск съел последнюю заморозку — серия жива, бонуса нет; следующий пропуск рвёт серию — бонус положен", () => {
    // день 3 пропущен и съел единственную заморозку: серия жива, защиты больше нет, но и возвращаться неоткуда.
    const state = streakState(onTime(1, 2), 4, policy({ freezes: 1 }));
    expect(state).toMatchObject({ freezesLeft: 0, current: 2, comebackEligible: false });
    // дни 3 и 4 пропущены: день 3 съел заморозку, день 4 оборвал серию.
    expect(streakState(onTime(1, 2), 5, policy({ freezes: 1 }))).toMatchObject({ current: 0, comebackEligible: true });
  });

  it("тот, кто пришёл впервые, не «возвращается»", () => {
    expect(streakState([], 4, policy()).comebackEligible).toBe(false);
    expect(streakState(late(), 1, policy()).comebackEligible).toBe(false);
  });

  it("догнанные дни без серии тоже дают право на бонус, если вчера не открыто вовремя", () => {
    expect(streakState([...onTime(1), ...late(2)], 3, policy()).comebackEligible).toBe(true);
  });

  it("в первый день бонуса нет", () => {
    expect(streakState([], 1, policy()).comebackEligible).toBe(false);
  });
});
