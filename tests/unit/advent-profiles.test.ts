/* eslint-disable @typescript-eslint/no-explicit-any -- тесты проверяют слабо типизированный результат слияния */
import { describe, expect, it } from "vitest";

import { PROFILE_IDS, adventProfileSchema, applyProfile, resolveProfileGoals, type AdventProfile } from "@/config/advent-profile";
import { adventSchema } from "@/config/advent-schema";
import { rawProfiles } from "@profiles/index";

import { adventFixture } from "../fixtures/advent";

const parse = (id: string): AdventProfile => adventProfileSchema.parse(rawProfiles[id]);

describe("профили бизнеса", () => {
  it("манифест содержит ровно пять профилей из PROFILE_IDS", () => {
    expect(Object.keys(rawProfiles).sort()).toEqual([...PROFILE_IDS].sort());
  });

  it.each(PROFILE_IDS)("профиль %s разбирается, id совпадает с ключом манифеста", (id) => {
    const profile = parse(id);
    expect(profile.id).toBe(id);
    expect(profile.toneHints.length).toBeGreaterThan(0);
    expect(profile.dayTemplates?.length).toBeGreaterThanOrEqual(2);
  });

  it("значения по таблице ADVENT_PLAN §1.2", () => {
    expect(parse("retail").schedule?.catchUp).toEqual({ window: 2 });
    expect(parse("retail").rewards?.[0]).toMatchObject({ kind: "promo", validDays: 3, redeem: "online" });
    expect(parse("horeca").schedule?.catchUp).toEqual({ window: 1 });
    expect(parse("horeca").rewards?.[0]).toMatchObject({ redeem: "cashier" });
    expect(parse("horeca").rewards?.[0].validDays).toBeLessThanOrEqual(2);
    expect(parse("beauty").schedule?.catchUp).toEqual({ window: 2 });
    expect(parse("beauty").rewards?.[0]).toMatchObject({ validDays: 7, redeem: "both" });
    expect(parse("b2b").schedule?.catchUp).toBe("all");
    expect(parse("corporate").schedule?.catchUp).toBe("all");
    expect(parse("corporate").audience).toEqual({ kind: "employees", leaderboard: "teams" });
    expect(parse("corporate").rewards?.some((reward) => reward.kind === "promo")).toBe(false);
  });

  it("лишние поля в профиле отвергаются", () => {
    expect(adventProfileSchema.safeParse({ ...rawProfiles.retail as object, startDate: "2026-12-20" }).success).toBe(false);
  });

  it("ссылки профиля на награды должны разрешаться", () => {
    const broken = structuredClone(rawProfiles.retail) as { streak: { comebackBonusRewardId: string } };
    broken.streak.comebackBonusRewardId = "ghost";
    const result = adventProfileSchema.safeParse(broken);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Профиль ссылается на награду");
  });

  it("профиль horeca вместе с черновиком даёт валидный адвент", () => {
    const draft = adventFixture();
    for (const key of ["streak", "rewards", "luck", "reminders", "audience", "presentation"]) delete draft[key];
    delete draft.schedule.catchUp;
    delete draft.schedule.rewardOnlyOnDay;
    // дни ссылаются на награды профиля
    draft.days = draft.days.map((day: any) => ({
      ...day,
      rewardId: day.rewardId ? "daily-gift" : undefined,
      blocks: day.blocks.map((block: any) => (block.type === "promo" ? { ...block, rewardId: "daily-gift" } : block))
    }));
    const merged = applyProfile(parse("horeca"), draft);
    const result = adventSchema.safeParse(merged);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success && result.data.schedule.catchUp).toEqual({ window: 1 });
  });
});

describe("resolveProfileGoals", () => {
  const goals = [
    { openedShare: 0.4, rewardId: "goal" },
    { openedShare: 0.75, rewardId: "final" }
  ];

  it.each([
    [5, [2, 4]],
    [12, [5, 9]],
    [24, [10, 18]],
    [31, [13, 24]]
  ])("%i дней → opened %j", (days, opened) => {
    expect(resolveProfileGoals(goals, days)).toEqual([
      { opened: opened[0], rewardId: "goal" },
      { opened: opened[1], rewardId: "final" }
    ]);
  });

  it("доля 1 — все дни, крошечная доля — не меньше одного дня, погрешность float не добавляет день", () => {
    expect(resolveProfileGoals([{ openedShare: 1, rewardId: "all" }], 31)).toEqual([{ opened: 31, rewardId: "all" }]);
    expect(resolveProfileGoals([{ openedShare: 0.01, rewardId: "one" }], 5)).toEqual([{ opened: 1, rewardId: "one" }]);
    expect(resolveProfileGoals([{ openedShare: 0.3, rewardId: "three" }], 10)).toEqual([{ opened: 3, rewardId: "three" }]);
  });

  it("совпадающий opened: остаётся первая цель по порядку", () => {
    const close = [
      { openedShare: 0.9, rewardId: "first" },
      { openedShare: 1, rewardId: "second" }
    ];
    expect(resolveProfileGoals(close, 5)).toEqual([{ opened: 5, rewardId: "first" }]);
  });

  it("профиль с долями, совпадающими на каких-то 5–31 днях, отвергается", () => {
    const close = structuredClone(rawProfiles.retail) as any;
    close.streak.goals = [
      { openedShare: 0.9, rewardId: "goal-promo" },
      { openedShare: 1, rewardId: "final-entry" }
    ];
    const result = adventProfileSchema.safeParse(close);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Цели серии совпадают при 5 днях");
  });

  it("абсолютное opened в профиле больше не принимается", () => {
    const old = structuredClone(rawProfiles.retail) as any;
    old.streak.goals = [{ opened: 5, rewardId: "goal-promo" }];
    expect(adventProfileSchema.safeParse(old).success).toBe(false);
  });

  it.each(PROFILE_IDS)("профиль %s: цели на 12 днях как в §1.2, на 5 и 31 днях — без совпадений и в пределах дней", (id) => {
    const profile = parse(id);
    for (const days of [5, 12, 24, 31]) {
      const resolved = resolveProfileGoals(profile.streak?.goals ?? [], days);
      expect(resolved).toHaveLength(profile.streak?.goals?.length ?? 0);
      for (const goal of resolved) expect(goal.opened).toBeLessThanOrEqual(days);
    }
  });
});

describe("applyProfile", () => {
  const profile = parse("retail");

  it("значения профиля подставляются там, где черновик молчит", () => {
    const merged = applyProfile(profile, { slug: "x" }) as any;
    expect(merged.slug).toBe("x");
    expect(merged.schedule.catchUp).toEqual({ window: 2 });
    expect(merged.streak.freezes).toBe(1);
  });

  it("черновик побеждает, соседние поля профиля сохраняются", () => {
    const merged = applyProfile(profile, { schedule: { catchUp: "all" }, streak: { freezes: 3 } }) as any;
    expect(merged.schedule.catchUp).toBe("all");
    expect(merged.schedule.rewardOnlyOnDay).toBe(false);
    expect(merged.schedule.unlockHour).toBe(0);
    expect(merged.streak.freezes).toBe(3);
    expect(merged.streak.endowedDay).toBe(true);
  });

  it("объект catchUp заменяется целиком, а не сливается", () => {
    const merged = applyProfile(profile, { schedule: { catchUp: { window: 1 } } }) as any;
    expect(merged.schedule.catchUp).toEqual({ window: 1 });
  });

  it("массивы заменяются, а не склеиваются", () => {
    const rewards = [{ id: "only", kind: "gift", label: "Один", redeem: "none" }];
    const merged = applyProfile(profile, { rewards, streak: { goals: [] } }) as any;
    expect(merged.rewards).toEqual(rewards);
    expect(merged.streak.goals).toEqual([]);
  });

  it("undefined в черновике не затирает значение профиля", () => {
    const merged = applyProfile(profile, { schedule: { catchUp: undefined } }) as any;
    expect(merged.schedule.catchUp).toEqual({ window: 2 });
  });

  it("цели профиля пересчитываются под schedule.days черновика", () => {
    expect((applyProfile(profile, { schedule: { days: 12 } }) as any).streak.goals).toEqual([
      { opened: 5, rewardId: "goal-promo" },
      { opened: 9, rewardId: "final-entry" }
    ]);
    expect((applyProfile(profile, { schedule: { days: 24 } }) as any).streak.goals).toEqual([
      { opened: 10, rewardId: "goal-promo" },
      { opened: 18, rewardId: "final-entry" }
    ]);
  });

  it("свои цели черновика важнее, а без schedule.days цели профиля не переносятся", () => {
    const own = [{ opened: 3, rewardId: "goal-promo" }];
    expect((applyProfile(profile, { schedule: { days: 12 }, streak: { goals: own } }) as any).streak.goals).toEqual(own);
    const noDays = applyProfile(profile, {}) as any;
    expect(noDays.streak.goals).toBeUndefined();
    expect(noDays.streak.freezes).toBe(1);
  });

  it("служебные поля профиля в результат не попадают", () => {
    const merged = applyProfile(profile, {});
    for (const key of ["id", "title", "toneHints", "dayTemplates"]) expect(merged).not.toHaveProperty(key);
  });

  it("ключ __proto__ из JSON-черновика не подменяет прототип и не протекает в результат", () => {
    const draft = JSON.parse('{"__proto__": {"polluted": true}, "schedule": {"__proto__": {"catchUp": "all"}}, "luck": {"constructor": {"x": 1}}}');
    const merged = applyProfile(profile, draft) as any;
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged.polluted).toBeUndefined();
    expect(Object.getPrototypeOf(merged.schedule)).toBe(Object.prototype);
    expect(merged.schedule.catchUp).toEqual({ window: 2 });
    expect(Object.hasOwn(merged.luck, "constructor")).toBe(false);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("__proto__ внутри объектов массива черновика тоже отсеивается", () => {
    const draft = JSON.parse('{"rewards": [{"__proto__": {"polluted": true}, "id": "r1", "tags": [{"__proto__": {"x": 1}}]}]}');
    const merged = applyProfile(profile, draft) as any;
    expect(Object.keys(merged.rewards[0])).toEqual(["id", "tags"]);
    expect(Object.hasOwn(merged.rewards[0].tags[0], "__proto__")).toBe(false);
    expect(Object.assign({}, merged.rewards[0]).polluted).toBeUndefined();
  });

  it("не изменяет ни профиль, ни черновик", () => {
    const before = structuredClone(profile);
    const draft = { schedule: { catchUp: "all", days: 12 } };
    const draftBefore = structuredClone(draft);
    const merged = applyProfile(profile, draft) as any;
    merged.rewards[0].label = "изменено";
    merged.streak.goals.push({ opened: 1, rewardId: "x" });
    expect(profile).toEqual(before);
    expect(draft).toEqual(draftBefore);
  });
});
