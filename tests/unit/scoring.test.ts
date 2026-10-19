import { describe, expect, it } from "vitest";

import {
  comboBonus,
  elapsedSeconds,
  fusesLeft,
  nextCombo,
  noFailBonus,
  resolveReward,
  rushPoints,
  speedBonus,
  summarizeRoom,
  totalScore
} from "@/domain/scoring";

describe("combo", () => {
  it("counts consecutive 100s and resets on 50 or 0", () => {
    expect(nextCombo(0, 100)).toBe(1);
    expect(nextCombo(1, 100)).toBe(2);
    expect(nextCombo(5, 50)).toBe(0);
    expect(nextCombo(5, 0)).toBe(0);
  });

  it.each([
    [0, 0],
    [1, 0],
    [2, 25],
    [3, 50],
    [4, 75],
    [5, 75],
    [15, 75]
  ])("gives combo %i a bonus of %i", (combo, bonus) => {
    expect(comboBonus(combo)).toBe(bonus);
  });
});

describe("fuses and the no-failure bonus", () => {
  it("takes a fuse for every zero, but not for a 50", () => {
    expect(fusesLeft([100, 100, 100])).toBe(3);
    expect(fusesLeft([100, 50, 100])).toBe(3);
    expect(fusesLeft([0, 100, 50])).toBe(2);
    expect(fusesLeft([0, 0, 0])).toBe(0);
  });

  it("awards 50 only for a finished room without zeros", () => {
    expect(noFailBonus([100, 50, 100])).toBe(50);
    expect(noFailBonus([100, 0, 100])).toBe(0);
    expect(noFailBonus([100, 100])).toBe(0);
  });
});

describe("speed bonus", () => {
  it.each([
    [0, 300, 150],
    [30, 300, 90],
    [74, 300, 2],
    [75, 300, 0],
    [200, 300, 0],
    [30, 150, 45],
    [30, 250, 75],
    [31, 250, 73],
    [10, 0, 0]
  ])("gives %i seconds on a base of %i a bonus of %i", (seconds, base, bonus) => {
    expect(speedBonus(seconds, base)).toBe(bonus);
  });

  it("measures whole seconds, rounding down, and never goes negative", () => {
    expect(elapsedSeconds(41_999)).toBe(41);
    expect(elapsedSeconds(-5_000)).toBe(0);
  });
});

describe("summarizeRoom", () => {
  const answer = (base: number, bonus: number, seconds: number) => ({
    base,
    comboBonus: bonus,
    durationMs: seconds * 1000
  });

  it("adds the no-failure and proportional speed bonuses to a finished room", () => {
    const summary = summarizeRoom("mail", [answer(100, 0, 10), answer(100, 25, 10), answer(50, 0, 20)]);
    // Время комнаты 40 с: (75 − 40) × 2 = 70, доля базы 250 / 300 → 58 (вниз).
    expect(summary).toMatchObject({
      completed: true,
      base: 250,
      comboBonus: 25,
      fuses: 3,
      noFailBonus: 50,
      speedBonus: 58,
      elapsedSeconds: 40,
      total: 383
    });
  });

  it("sums the time of the three tasks", () => {
    const summary = summarizeRoom("mail", [answer(100, 0, 5), answer(100, 25, 6), answer(100, 50, 49)]);
    expect(summary.elapsedSeconds).toBe(60);
    expect(summary.speedBonus).toBe(30);
  });

  it("rounds the total time down, not each task", () => {
    const summary = summarizeRoom("mail", [
      { base: 100, comboBonus: 0, durationMs: 10_600 },
      { base: 100, comboBonus: 0, durationMs: 10_600 },
      { base: 100, comboBonus: 0, durationMs: 10_600 }
    ]);
    expect(summary.elapsedSeconds).toBe(31);
  });

  it("gives no speed bonus for a room of zeros however fast it was", () => {
    const summary = summarizeRoom("mail", [answer(0, 0, 1), answer(0, 0, 1), answer(0, 0, 1)]);
    expect(summary).toMatchObject({ base: 0, elapsedSeconds: 3, speedBonus: 0, total: 0 });
  });

  it("gives no room bonuses and no speed until the room is finished", () => {
    const summary = summarizeRoom("mail", [answer(100, 0, 5), answer(0, 0, 6)]);
    expect(summary).toMatchObject({ completed: false, noFailBonus: 0, speedBonus: 0, elapsedSeconds: null, fuses: 2, total: 100 });
  });

  it("loses the no-failure bonus after a zero", () => {
    const summary = summarizeRoom("mail", [answer(0, 0, 5), answer(100, 0, 6), answer(100, 25, 7)]);
    expect(summary.noFailBonus).toBe(0);
    expect(summary.fuses).toBe(2);
  });
});

describe("total score", () => {
  it("sums rooms and 20 points per rush hit", () => {
    const room = summarizeRoom("mail", []);
    expect(rushPoints(7)).toBe(140);
    expect(totalScore([room, room], 7)).toBe(140);
  });
});

describe("resolveReward", () => {
  const tiers = [
    { minScore: 0, title: "Starter" },
    { minScore: 1700, title: "Expert" },
    { minScore: 2400, title: "Architect" },
    { minScore: 3000, title: "Master" }
  ];

  it.each([
    [0, "Starter"],
    [1699, "Starter"],
    [1700, "Expert"],
    [2399, "Expert"],
    [2400, "Architect"],
    [2999, "Architect"],
    [3000, "Master"],
    [3825, "Master"]
  ])("maps %i points to %s", (score, title) => {
    expect(resolveReward(score, tiers).title).toBe(title);
  });

  it("rejects negative and fractional scores", () => {
    expect(() => resolveReward(-1, tiers)).toThrow();
    expect(() => resolveReward(10.5, tiers)).toThrow();
  });
});
