import { describe, expect, it } from "vitest";

import { MIN_GROUP, addDays, bestStreakHistogram, buildInsights, histogramStats, rankTeams, reportPaperTheme, retentionRate, share } from "@/domain/advent";
import { contrastRatio } from "@/domain/color";

import { analyticsFixture, dayRow } from "../support/analytics-fixture";

describe("share и addDays", () => {
  it("доля с нулевым основанием — null", () => {
    expect(share(1, 4)).toBe(0.25);
    expect(share(0, 0)).toBeNull();
  });

  it("addDays переходит через месяц, год и високосный февраль", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-20", 7)).toBe("2026-12-27");
  });
});

describe("histogramStats", () => {
  it("среднее и медиана нечётного числа участников", () => {
    // Значения 1, 1, 3: среднее 5/3, медиана 1.
    const stats = histogramStats([{ value: 1, count: 2 }, { value: 3, count: 1 }]);
    expect(stats.total).toBe(3);
    expect(stats.avg).toBeCloseTo(5 / 3);
    expect(stats.median).toBe(1);
  });

  it("медиана чётного числа — среднее двух центральных", () => {
    // 1, 3 → 2; 1, 2, 2, 9 → 2.
    expect(histogramStats([{ value: 1, count: 1 }, { value: 3, count: 1 }]).median).toBe(2);
    expect(histogramStats([{ value: 9, count: 1 }, { value: 2, count: 2 }, { value: 1, count: 1 }]).median).toBe(2);
  });

  it("пустая гистограмма и нулевые счётчики — null", () => {
    expect(histogramStats([])).toEqual({ total: 0, avg: null, median: null });
    expect(histogramStats([{ value: 4, count: 0 }]).avg).toBeNull();
  });
});

describe("retentionRate: возврат считается по созревшим когортам", () => {
  const cohorts = [
    { date: "2026-12-20", size: 3, returned: [{ offset: 1, count: 1 }, { offset: 7, count: 1 }] },
    { date: "2026-12-21", size: 2, returned: [{ offset: 1, count: 2 }] }
  ];

  it("когорта, у которой день ещё не наступил, не попадает в основание", () => {
    // Сегодня 21.12: для +1 созрела только когорта 20.12 (21.12 ≤ 21.12), когорта 21.12 ждёт 22.12.
    expect(retentionRate(cohorts, 1, "2026-12-21")).toEqual({ count: 1, base: 3 });
    expect(retentionRate(cohorts, 1, "2026-12-22")).toEqual({ count: 3, base: 5 });
  });

  it("D7: до 27.12 нет созревших когорт", () => {
    expect(retentionRate(cohorts, 7, "2026-12-26")).toEqual({ count: 0, base: 0 });
    expect(retentionRate(cohorts, 7, "2026-12-27")).toEqual({ count: 1, base: 3 });
  });
});

describe("bestStreakHistogram: лучшая серия по рисункам открытых вовремя дней", () => {
  const policy = { endowedDay: false, freezes: 0, goals: [] };

  it("считает по тем же правилам, что серия участника", () => {
    const patterns = [{ days: [1, 2, 3], count: 2 }, { days: [1, 3], count: 1 }, { days: [], count: 4 }];
    expect(bestStreakHistogram(patterns, 3, policy)).toEqual([
      { value: 0, count: 4 },
      { value: 1, count: 1 },
      { value: 3, count: 2 }
    ]);
  });

  it("заморозка сохраняет серию через пропуск", () => {
    // Дни 1 и 3 вовремя, день 2 пропущен: с одной заморозкой серия 2, без заморозок 1.
    expect(bestStreakHistogram([{ days: [1, 3], count: 1 }], 3, { ...policy, freezes: 1 })).toEqual([{ value: 2, count: 1 }]);
    expect(bestStreakHistogram([{ days: [1, 3], count: 1 }], 3, policy)).toEqual([{ value: 1, count: 1 }]);
  });

  it("до старта серий нет", () => {
    expect(bestStreakHistogram([{ days: [], count: 3 }], null, policy)).toEqual([{ value: 0, count: 3 }]);
  });
});

describe("rankTeams", () => {
  const team = (id: string, members: number, players: number, doors: number) => ({ id, title: id.toUpperCase(), members, players, doors, points: doors * 10 });

  it("ранжирует по среднему числу дверей на участника, а не по сумме", () => {
    // Большая команда: 10 человек, 30 дверей (3,0). Малая: 4 человека, 14 дверей (3,5) — впереди малая.
    const ranked = rankTeams([team("big", 10, 8, 30), team("small", 4, 4, 14)], 3);
    expect(ranked.map((row) => [row.id, row.rank, row.avgDoors])).toEqual([["small", 1, 3.5], ["big", 2, 3]]);
    expect(ranked[1].activeShare).toBeCloseTo(0.8);
  });

  it("равные по среднему и доле делят место", () => {
    const ranked = rankTeams([team("a", 4, 4, 8), team("b", 4, 4, 8), team("c", 4, 4, 4)], 3);
    expect(ranked.map((row) => row.rank)).toEqual([1, 1, 3]);
  });

  it("команда меньше порога без цифр и без места, в конце списка", () => {
    const ranked = rankTeams([team("tiny", 2, 2, 20), team("ok", 3, 3, 3)], 3);
    expect(ranked.map((row) => row.id)).toEqual(["ok", "tiny"]);
    expect(ranked[1]).toMatchObject({ hidden: true, rank: null, avgDoors: null, activeShare: null, avgPoints: null });
  });

  it("порог — именно «меньше»: ровно minMembers уже видна", () => {
    expect(rankTeams([team("x", 5, 1, 1)], 5)[0].hidden).toBe(false);
    expect(rankTeams([team("x", 4, 1, 1)], 5)[0].hidden).toBe(true);
  });
});

describe("reportPaperTheme: акцент бренда на белой бумаге читается", () => {
  it.each(["#ffe600", "#f5b301", "#0a3d91", "#e11d48", "#7ee0ff"])("акцент %s даёт контраст не меньше 4,5:1", (accent) => {
    const theme = reportPaperTheme(accent);
    expect(contrastRatio(theme.accent, theme.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.muted, theme.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.ink, theme.paper)).toBeGreaterThanOrEqual(7);
  });

  it("достаточно тёмный акцент не меняется", () => {
    expect(reportPaperTheme("#0a3d91").accent).toBe("#0a3d91");
  });
});

describe("buildInsights: правила выводов", () => {
  const keys = (data: ReturnType<typeof analyticsFixture>) => buildInsights(data).map((insight) => insight.key);

  it("мало игроков — один вывод «мало данных», остальные молчат", () => {
    const data = analyticsFixture({ kpis: { ...analyticsFixture().kpis, players: MIN_GROUP - 1 } });
    expect(buildInsights(data).map((insight) => insight.key)).toEqual(["few-data"]);
  });

  it("падение доли открывших в свой день к концу — предупреждение с цифрами", () => {
    const days = [0.8, 0.78, 0.6, 0.55, 0.4, 0.35].map((value, index) => dayRow(index + 1, { onTimeShare: value, active: 100, opened: Math.round(value * 100), onTime: Math.round(value * 100) }));
    const trend = buildInsights(analyticsFixture({ days })).find((insight) => insight.key === "trend")!;
    expect(trend.tone).toBe("watch");
    // Первая треть (2 дня): (0,8 + 0,78) / 2 = 0,79 → 79%; последняя: (0,4 + 0,35) / 2 = 0,375 → 38%.
    expect(trend.text).toContain("79%");
    expect(trend.text).toContain("38%");
  });

  it("ровный интерес — «держался»", () => {
    expect(buildInsights(analyticsFixture()).find((insight) => insight.key === "trend")?.tone).toBe("good");
  });

  it("D1: низкий — предупреждение, высокий — хорошо, средний — молчит", () => {
    const base = analyticsFixture().kpis;
    const d1 = (share: number) => buildInsights(analyticsFixture({ kpis: { ...base, d1: { count: share * 100, base: 100, share } } })).find((insight) => insight.key === "d1");
    expect(d1(0.1)?.tone).toBe("watch");
    expect(d1(0.45)?.tone).toBe("good");
    expect(d1(0.3)).toBeUndefined();
  });

  it("D1 с малым основанием не комментируется", () => {
    const base = analyticsFixture().kpis;
    expect(keys(analyticsFixture({ kpis: { ...base, d1: { count: 0, base: 3, share: 0 } } }))).not.toContain("d1");
  });

  it("погашение: низкое и высокое; награды без кассы не считаются", () => {
    const reward = (patch: object) => ({ rewardId: "r", label: "Кофе", kind: "gift" as const, issued: 20, redeemed: 2, expired: 0, redeemable: true, redeemShare: 0.1, stockLeft: null, stockTotal: null, codesFree: null, codesTotal: null, ...patch });
    expect(buildInsights(analyticsFixture({ rewards: [reward({})] })).find((insight) => insight.key === "redeem")?.tone).toBe("watch");
    expect(buildInsights(analyticsFixture({ rewards: [reward({ redeemed: 15 })] })).find((insight) => insight.key === "redeem")?.tone).toBe("good");
    expect(keys(analyticsFixture({ rewards: [reward({ redeemable: false })] }))).not.toContain("redeem");
    expect(keys(analyticsFixture({ rewards: [reward({ expired: 8 })] }))).toContain("expired");
  });

  it("остатки: разыгран полностью и закончились коды", () => {
    const base = { issued: 0, redeemed: 0, expired: 0, redeemable: true, redeemShare: null, kind: "promo" as const };
    const data = analyticsFixture({
      rewards: [
        { ...base, rewardId: "luck", label: "Кружка", stockLeft: 0, stockTotal: 10, codesFree: null, codesTotal: null },
        { ...base, rewardId: "codes", label: "Скидка", stockLeft: null, stockTotal: null, codesFree: 0, codesTotal: 50 }
      ]
    });
    expect(keys(data)).toEqual(expect.arrayContaining(["stock-luck", "pool-codes"]));
  });

  it("команды: лидер и отстающий называются по названию", () => {
    const team = (id: string, title: string, rank: number, avgDoors: number) => ({ id, title, hidden: false, members: 10, players: 8, avgDoors, activeShare: 0.8, points: 100, avgPoints: 10, rank });
    const text = buildInsights(analyticsFixture({ teams: [team("a", "Север", 1, 4.25), team("b", "Юг", 2, 2.5)] })).find((insight) => insight.key === "teams")!.text;
    // Названия команд — как в пакете, без дополнительных кавычек: у «Команда «Юг»» они удвоились бы.
    expect(text).toContain("Впереди — Север");
    expect(text).toContain("4,3");
    expect(text).toContain("Юг");
  });
});

describe("retentionRate: срок возврата вне дней кампании", () => {
  const cohorts = [
    { date: "2026-12-29", size: 10, returned: [{ offset: 1, count: 4 }] },
    { date: "2026-12-31", size: 8, returned: [] }
  ];
  const openable = { first: "2026-12-20", last: "2026-12-31" };

  it("когорта, чей D1 выпал после финала, не считается «не вернувшейся»", () => {
    // Без ограничения 31.12 (+1 = 01.01, двери уже закрыты) занижала бы возврат: 4 из 18.
    expect(retentionRate(cohorts, 1, "2027-01-05")).toEqual({ count: 4, base: 18 });
    expect(retentionRate(cohorts, 1, "2027-01-05", openable)).toEqual({ count: 4, base: 10 });
  });

  it("день возврата до первого дня кампании тоже вне основания", () => {
    expect(retentionRate([{ date: "2026-12-18", size: 6, returned: [] }], 1, "2026-12-25", openable)).toEqual({ count: 0, base: 0 });
  });
});
