import { describe, expect, it } from "vitest";

import { CODE_ALPHABET, NDFL_THRESHOLD_RUB, generateRewardCode, isOverNdflThreshold, rewardExpiresAt } from "@/domain/advent/rewards";

describe("rewardExpiresAt", () => {
  const grantedAt = new Date("2026-12-20T10:00:00Z");

  it("прибавляет validDays суток к моменту выдачи", () => {
    expect(rewardExpiresAt(grantedAt, { validDays: 3 })?.toISOString()).toBe("2026-12-23T10:00:00.000Z");
    expect(rewardExpiresAt(grantedAt, { validDays: 1 })?.toISOString()).toBe("2026-12-21T10:00:00.000Z");
  });

  it("без срока — null, исходная дата не меняется", () => {
    expect(rewardExpiresAt(grantedAt, {})).toBeNull();
    expect(rewardExpiresAt(grantedAt, { validDays: undefined })).toBeNull();
    expect(grantedAt.toISOString()).toBe("2026-12-20T10:00:00.000Z");
  });
});

describe("isOverNdflThreshold", () => {
  it("порог 4000 ₽ не включая", () => {
    expect(NDFL_THRESHOLD_RUB).toBe(4000);
    expect(isOverNdflThreshold({ valueRub: 4000 })).toBe(false);
    expect(isOverNdflThreshold({ valueRub: 4001 })).toBe(true);
    expect(isOverNdflThreshold({})).toBe(false);
  });
});

describe("generateRewardCode", () => {
  const sequence = (values: number[]) => {
    let index = 0;
    return () => values[index++ % values.length];
  };

  it("префикс и нужное число символов", () => {
    const code = generateRewardCode("NY", 6, sequence([0, 0.5, 0.99]));
    expect(code).toHaveLength(8);
    expect(code.startsWith("NY")).toBe(true);
  });

  it("детерминирован для детерминированного rng", () => {
    expect(generateRewardCode("A", 5, sequence([0.1, 0.2, 0.3]))).toBe(generateRewardCode("A", 5, sequence([0.1, 0.2, 0.3])));
  });

  it("первый и последний символы алфавита; rng = 1 − ε не выходит за алфавит", () => {
    expect(generateRewardCode("", 2, () => 0)).toBe("00");
    expect(generateRewardCode("", 2, () => 0.9999999999)).toBe("ZZ");
  });

  it("в алфавите нет путаемых символов I, L, O, U, а коды — только из алфавита", () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(CODE_ALPHABET).not.toMatch(/[ILOU]/);
    let seed = 1;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let index = 0; index < 200; index += 1) {
      expect(generateRewardCode("", 12, rng)).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    }
  });

  it("нулевая длина — только префикс", () => {
    expect(generateRewardCode("NY", 0, () => 0.5)).toBe("NY");
  });
});
