import { describe, expect, it } from "vitest";

import { bulbPositions, garlandModel, GARLAND_MAX_BULBS, pluralForm, wirePoint } from "@/domain/advent";

describe("garlandModel: гирлянда-шкала", () => {
  it("до 16 дней огонёк на день; горит столько, сколько открыто (с подаренным днём)", () => {
    expect(garlandModel(12, 0, 4)).toMatchObject({ bulbs: 12, perBulb: 1, lit: 0, goalBulb: 4, left: 4 });
    expect(garlandModel(12, 4, 8)).toMatchObject({ lit: 4, goalBulb: 8, left: 4 });
    expect(garlandModel(12, 12, null)).toMatchObject({ lit: 12, goalBulb: null, left: 0 });
  });

  it("при N > 16 огоньки — сегменты по нескольку дней, значок цели на своём сегменте", () => {
    expect(garlandModel(24, 0, 12)).toMatchObject({ bulbs: 12, perBulb: 2, goalBulb: 6 });
    expect(garlandModel(31, 0, 31)).toMatchObject({ bulbs: 16, perBulb: 2, goalBulb: 16 });
    // Сегмент горит целиком, когда открыты все его дни.
    expect(garlandModel(24, 5, 12).lit).toBe(2);
    expect(garlandModel(24, 24, null).lit).toBe(12);
    for (const days of [5, 7, 12, 16, 17, 24, 31]) expect(garlandModel(days, 0, null).bulbs).toBeLessThanOrEqual(GARLAND_MAX_BULBS);
  });

  it("прогресс вне границ не ломает шкалу", () => {
    expect(garlandModel(12, 99, null).lit).toBe(12);
    expect(garlandModel(12, -3, 5).lit).toBe(0);
    expect(garlandModel(12, 3, 99).goalBulb).toBe(12);
  });

  it("позиции огоньков лежат на проводе и идут слева направо", () => {
    const points = bulbPositions(12, 360, 8, 20);
    expect(points).toHaveLength(12);
    for (let index = 1; index < points.length; index += 1) expect(points[index].x).toBeGreaterThan(points[index - 1].x);
    // Провис: середина ниже краёв.
    expect(points[5].y).toBeGreaterThan(points[0].y);
    expect(wirePoint(0.5, 360, 8, 20)).toEqual({ x: 180, y: 28 });
    expect(wirePoint(0, 360, 8, 20).y).toBe(8);
  });

  it("склонение: 1 огонёк, 2 огонька, 5 огоньков, 11 огоньков, 21 огонёк", () => {
    const forms = ["огонёк", "огонька", "огоньков"] as const;
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25].map((count) => pluralForm(count, forms))).toEqual([
      "огонёк", "огонька", "огонька", "огоньков", "огоньков", "огоньков", "огонёк", "огонька", "огоньков"
    ]);
  });
});
