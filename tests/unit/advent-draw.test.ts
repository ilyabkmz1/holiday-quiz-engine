import { describe, expect, it } from "vitest";

import { drawLuck, luckSeed, type LuckPoolItem } from "@/domain/advent/draw";

const pool: LuckPoolItem[] = [
  { rewardId: "small", weight: 6 },
  { rewardId: "medium", weight: 3 },
  { rewardId: "large", weight: 1 }
];

describe("luckSeed", () => {
  it("стабилен для одних и тех же входных данных", () => {
    expect(luckSeed("zerno", "p1", 3)).toBe(luckSeed("zerno", "p1", 3));
  });

  it("различается по кампании, участнику и дню", () => {
    const seeds = new Set([luckSeed("zerno", "p1", 3), luckSeed("other", "p1", 3), luckSeed("zerno", "p2", 3), luckSeed("zerno", "p1", 4)]);
    expect(seeds.size).toBe(4);
  });

  it("не склеивает поля: («ab», «c») ≠ («a», «bc»)", () => {
    expect(luckSeed("ab", "c", 1)).not.toBe(luckSeed("a", "bc", 1));
  });

  it("возвращает 32-битное целое без знака", () => {
    const seed = luckSeed("zerno", "p1", 1);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});

describe("drawLuck", () => {
  it("детерминирован: те же входные данные — тот же приз", () => {
    for (let participant = 0; participant < 50; participant += 1) {
      const seed = luckSeed("zerno", `p${participant}`, 4);
      expect(drawLuck(pool, {}, seed, "small")).toBe(drawLuck(pool, {}, seed, "small"));
    }
  });

  it("распределение примерно пропорционально весам", () => {
    const counts: Record<string, number> = { small: 0, medium: 0, large: 0 };
    const draws = 20000;
    for (let participant = 0; participant < draws; participant += 1) {
      counts[drawLuck(pool, {}, luckSeed("zerno", `participant-${participant}`, 4), "small")] += 1;
    }
    expect(counts.small / draws).toBeCloseTo(0.6, 1);
    expect(counts.medium / draws).toBeCloseTo(0.3, 1);
    expect(counts.large / draws).toBeCloseTo(0.1, 1);
  });

  it("приз с нулевым остатком не выпадает никогда", () => {
    for (let participant = 0; participant < 2000; participant += 1) {
      const result = drawLuck(pool, { large: 0, medium: 0 }, luckSeed("zerno", `p${participant}`, 1), "small");
      expect(result).toBe("small");
    }
  });

  it("остаток больше нуля или отсутствие ключа — приз доступен", () => {
    const seen = new Set<string>();
    for (let participant = 0; participant < 2000; participant += 1) {
      seen.add(drawLuck(pool, { large: 1, medium: undefined }, luckSeed("zerno", `p${participant}`, 1), "small"));
    }
    expect(seen).toEqual(new Set(["small", "medium", "large"]));
  });

  it("всё закончилось — утешительный приз", () => {
    expect(drawLuck(pool, { small: 0, medium: 0, large: 0 }, 12345, "consolation")).toBe("consolation");
    expect(drawLuck([], {}, 1, "consolation")).toBe("consolation");
  });

  it("без утешительного приза: гарантию даёт приз без лимита, а противоречивые остатки — ошибка", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      expect(drawLuck(pool, { medium: 0, large: 0 }, seed * 104729, undefined)).toBe("small");
    }
    expect(() => drawLuck(pool, { small: 0, medium: 0, large: 0 }, 1, undefined)).toThrow("утешительный приз не задан");
  });

  it("нулевой вес не выпадает", () => {
    const weighted: LuckPoolItem[] = [
      { rewardId: "never", weight: 0 },
      { rewardId: "always", weight: 1 }
    ];
    for (let seed = 0; seed < 500; seed += 1) expect(drawLuck(weighted, {}, seed * 7919, "fallback")).toBe("always");
  });

  it("крайние значения зерна не выходят за пул", () => {
    for (const seed of [0, 1, 2 ** 32 - 1]) expect(["small", "medium", "large"]).toContain(drawLuck(pool, {}, seed, "x"));
  });
});
