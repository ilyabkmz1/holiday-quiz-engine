/* eslint-disable @typescript-eslint/no-explicit-any -- тесты ломают слабо типизированную фикстуру по полям */
import { describe, expect, it } from "vitest";

import { adventSchema, daySpotId } from "@/config/advent-schema";
import { adventPackSchema, anyPackSchema, packSchema } from "@/config/pack";
import { campaignSchema } from "@/config/schema";
import { loadTenants } from "@/server/tenants";
import { pack as officePack } from "@tenants/demo-office/pack";
import demoCoffee from "@tenants/demo-coffee/pack.json" with { type: "json" };

import { adventFixture, adventPackFixture } from "../fixtures/advent";

/** Тексты ошибок разбора одним списком. */
function messages(input: unknown): string[] {
  const result = adventSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((item) => item.message);
}

describe("adventSchema", () => {
  it("принимает валидную фикстуру и проставляет значения по умолчанию", () => {
    const parsed = adventSchema.parse(adventFixture());
    expect(parsed.days).toHaveLength(12);
    expect(parsed.presentation).toBe("calendar");
    expect(parsed.reminders.channel).toBe("email");
    expect(parsed.copy.newOrnament).toBeTruthy();
  });

  it("заполняет необязательные секции по умолчанию", () => {
    const draft = adventFixture();
    delete draft.streak;
    delete draft.reminders;
    delete draft.audience;
    delete draft.luck;
    delete draft.presentation;
    draft.days = draft.days.map((day: any) => ({ ...day, blocks: day.blocks.filter((block: any) => block.type !== "luck") }));
    const parsed = adventSchema.parse(draft);
    expect(parsed.streak).toEqual({ endowedDay: false, freezes: 0, goals: [] });
    expect(parsed.reminders.sendAtLocal).toBe("10:00");
    expect(parsed.audience).toEqual({ kind: "customers", leaderboard: "off" });
  });

  it("разбирается повторно (идемпотентность разбора)", () => {
    const once = adventSchema.parse(adventFixture());
    expect(adventSchema.parse(once)).toEqual(once);
  });

  it.each([
    ["неизвестный часовой пояс", (d: any) => (d.schedule.timezone = "Mars/Base"), /IANA/],
    ["несуществующая дата начала", (d: any) => (d.schedule.startDate = "2026-02-30"), /существующая дата/],
    ["меньше 5 дней", (d: any) => (d.schedule.days = 4), /too small|>=5|least 5/i],
    ["больше 31 дня", (d: any) => (d.schedule.days = 32), /too big|<=31|most 31/i],
    ["час открытия вне 0–23", (d: any) => (d.schedule.unlockHour = 24), /too big|<=23|most 23/i],
    ["окно догоняния больше 7", (d: any) => (d.schedule.catchUp = { window: 8 }), /too big|<=7|most 7|Invalid/i],
    ["заморозок больше 3", (d: any) => (d.streak.freezes = 4), /too big|<=3|most 3/i],
    ["блок word пока не поддерживается", (d: any) => (d.days[0].blocks[0] = { type: "word" }), /Invalid discriminator/i]
  ])("отвергает: %s", (_name, mutate, expected) => {
    const draft = adventFixture();
    mutate(draft);
    expect(messages(draft).join("\n")).toMatch(expected);
  });

  describe("проверки superRefine", () => {
    it("дни идут подряд от 1 до schedule.days", () => {
      const gap = adventFixture();
      gap.days[5].n = 99;
      expect(messages(gap)).toContain("Дни должны идти подряд от 1 до 12 (schedule.days) без пропусков и повторов");

      const missing = adventFixture();
      missing.days.pop();
      expect(messages(missing)).toContain("Дни должны идти подряд от 1 до 12 (schedule.days) без пропусков и повторов");
    });

    it("дни могут идти в произвольном порядке, если номера полные", () => {
      const draft = adventFixture();
      draft.days.reverse();
      expect(messages(draft)).toEqual([]);
    });

    it("неизвестные награды: день, promo, пул удачи, цели, возвращение, утешительный приз", () => {
      const day = adventFixture();
      day.days[0].rewardId = "ghost";
      expect(messages(day)).toContain("Неизвестная награда в дне 1: ghost");

      const promo = adventFixture();
      promo.days[0].blocks[2] = { type: "promo", rewardId: "ghost" };
      expect(messages(promo)).toContain("Неизвестная награда в блоке promo дня 1: ghost");

      const teams = adventFixture();
      teams.audience = { kind: "employees", leaderboard: "teams", teams: [{ id: "sales", title: "Продажи" }, { id: "sales", title: "Сейлз" }] };
      expect(messages(teams)).toContain("Id команд (audience.teams) повторяются");

      const pool = adventFixture();
      pool.days[3].blocks[1].pool.push({ rewardId: "ghost", weight: 1 });
      expect(messages(pool)).toContain("Неизвестная награда в пуле удачи дня 4: ghost");

      const goal = adventFixture();
      goal.streak.goals[0].rewardId = "ghost";
      expect(messages(goal)).toContain("Неизвестная награда в streak.goals: ghost");

      const comeback = adventFixture();
      comeback.streak.comebackBonusRewardId = "ghost";
      expect(messages(comeback)).toContain("Неизвестная награда в streak.comebackBonusRewardId: ghost");

      const endowed = adventFixture();
      endowed.streak.endowedRewardId = "ghost";
      expect(messages(endowed)).toContain("Неизвестная награда в streak.endowedRewardId: ghost");

      const fallback = adventFixture();
      fallback.luck.fallbackRewardId = "ghost";
      expect(messages(fallback)).toContain("Неизвестная награда в luck.fallbackRewardId: ghost");
    });

    it("неизвестный герой в дне и задании", () => {
      const day = adventFixture();
      day.days[0].heroId = "ghost";
      expect(messages(day)).toContain("Неизвестный герой в дне 1: ghost");

      const task = adventFixture();
      task.days[0].blocks[1].task.heroId = "ghost";
      expect(messages(task).join("\n")).toMatch(/Неизвестный герой в задании beans-fresh: ghost/);
    });

    it("команды обязательны тогда и только тогда, когда рейтинг по командам", () => {
      const missing = adventFixture();
      missing.audience = { kind: "employees", leaderboard: "teams" };
      expect(messages(missing)).toContain("Для рейтинга по командам (leaderboard: teams) нужен список audience.teams");

      const extra = adventFixture();
      extra.audience.teams = [{ id: "sales", title: "Продажи" }];
      expect(messages(extra)).toContain("Команды audience.teams нужны только при leaderboard: teams");

      const ok = adventFixture();
      ok.audience = { kind: "employees", leaderboard: "teams", teams: [{ id: "sales", title: "Продажи" }] };
      expect(messages(ok)).toEqual([]);
    });

    it("пул удачи должен гарантировать приз", () => {
      const noGuarantee = adventFixture();
      noGuarantee.rewards.find((r: any) => r.id === "luck-a").stock = 5;
      delete noGuarantee.luck.fallbackRewardId;
      expect(messages(noGuarantee).join("\n")).toMatch(/нет гарантированного приза/);

      // Утешительный приз вне пула спасает, если у него нет stock.
      const viaFallback = adventFixture();
      viaFallback.rewards.find((r: any) => r.id === "luck-a").stock = 5;
      viaFallback.rewards.push({ id: "sticker", kind: "gift", label: "Стикер", redeem: "none" });
      viaFallback.luck.fallbackRewardId = "sticker";
      expect(messages(viaFallback)).toEqual([]);

      // Но если и он ограничен, гарантии нет.
      const limitedFallback = adventFixture();
      limitedFallback.rewards.find((r: any) => r.id === "luck-a").stock = 5;
      limitedFallback.rewards.push({ id: "sticker", kind: "gift", label: "Стикер", stock: 3, redeem: "none" });
      limitedFallback.luck.fallbackRewardId = "sticker";
      expect(messages(limitedFallback)).toContain("Утешительный приз luck.fallbackRewardId не должен иметь stock");
    });

    it("блок удачи требует секцию luck", () => {
      const draft = adventFixture();
      delete draft.luck;
      expect(messages(draft)).toContain("В дне 4 есть блок удачи, но не задана секция luck");
    });

    it("id вариантов задач и призов пула не выдают ответ", () => {
      const task = adventFixture();
      task.days[0].blocks[1].task.options[0].id = "correct-one";
      task.days[0].blocks[1].task.correctOptionId = "correct-one";
      expect(messages(task).join("\n")).toMatch(/Id варианта в задании beans-fresh подсказывает ответ: correct-one/);

      const luck = adventFixture();
      luck.rewards.find((r: any) => r.id === "luck-b").id = "luck-good";
      luck.days[3].blocks[1].pool[1].rewardId = "luck-good";
      luck.days[7].blocks[1].pool[1].rewardId = "luck-good";
      luck.days[11].blocks[1].pool[1].rewardId = "luck-good";
      expect(messages(luck).join("\n")).toMatch(/Id награды в пуле удачи дня 4 выдаёт её ценность: luck-good/);

      for (const revealing of ["luck-big", "small-gift", "GrandPrize", "consolation"]) {
        const sized = adventFixture();
        sized.rewards.find((r: any) => r.id === "luck-b").id = revealing;
        for (const day of [3, 7, 11]) sized.days[day].blocks[1].pool[1].rewardId = revealing;
        expect(messages(sized)).toContain(`Id награды в пуле удачи дня 4 выдаёт её ценность: ${revealing}`);
      }
    });

    it("повторы id: награды, задания, команды, пул удачи", () => {
      const rewards = adventFixture();
      rewards.rewards.push({ ...rewards.rewards[0] });
      expect(messages(rewards)).toContain("Id наград (rewards) повторяются");

      const tasks = adventFixture();
      tasks.days[1].blocks[1].task.id = tasks.days[0].blocks[1].task.id;
      expect(messages(tasks)).toContain("Id заданий в днях повторяются");

      const teams = adventFixture();
      teams.audience = { kind: "employees", leaderboard: "teams", teams: [{ id: "sales", title: "Продажи" }, { id: "sales", title: "Сейлз" }] };
      expect(messages(teams)).toContain("Id команд (audience.teams) повторяются");

      const pool = adventFixture();
      pool.days[3].blocks[1].pool.push({ rewardId: "luck-a", weight: 1 });
      expect(messages(pool)).toContain("Награды в пуле удачи дня 4 повторяются");
    });

    it("в дне не больше одного блока удачи: зерно розыгрыша общее на день", () => {
      const twice = adventFixture();
      twice.days[3].blocks.push(structuredClone(twice.days[3].blocks[1]));
      expect(twice.days[3].blocks.filter((block: any) => block.type === "luck")).toHaveLength(2);
      expect(messages(twice)).toEqual(["В дне 4 больше одного блока удачи: допускается один"]);
    });

    it("подарок за старт (streak.endowedRewardId) требует подаренного дня; поле необязательно", () => {
      const ok = adventFixture();
      ok.streak.endowedRewardId = "daily-gift";
      expect(messages(ok)).toEqual([]);
      const without = adventFixture();
      without.streak.endowedDay = false;
      without.streak.endowedRewardId = "daily-gift";
      expect(messages(without)).toContain("streak.endowedRewardId задан, а подаренного дня нет: включите streak.endowedDay");
    });

    it("цели серии достижимы и не повторяются", () => {
      const far = adventFixture();
      far.streak.goals[1].opened = 13;
      expect(messages(far)).toContain("Цель «открыть 13» недостижима: дней всего 12");

      const dup = adventFixture();
      dup.streak.goals[1].opened = dup.streak.goals[0].opened;
      expect(messages(dup)).toContain("Цели серии с одинаковым числом открытых дней повторяются");
    });

    it("даты упорядочены: финал позже открытия последнего дня, выдача не раньше финала", () => {
      const early = adventFixture();
      early.schedule.finaleAt = "2026-12-31T00:00:00+03:00"; // ровно открытие дня 12
      expect(messages(early)).toContain("Финал (finaleAt) должен быть позже открытия последнего дня");

      const claim = adventFixture();
      claim.schedule.claimEndsAt = "2026-12-31T23:00:00+03:00";
      expect(messages(claim)).toContain("Конец выдачи кодов (claimEndsAt) не может быть раньше финала (finaleAt)");

      const same = adventFixture();
      same.schedule.claimEndsAt = same.schedule.finaleAt;
      expect(messages(same)).toEqual([]);
    });

    it("проверяет контраст бренда", () => {
      const draft = adventFixture();
      draft.brand = { ...draft.brand, colors: { ...draft.brand.colors, bg: "#222222", ink: "#2a2a2a" } };
      expect(messages(draft).join("\n")).toMatch(/Низкий контраст в палитре бренда/);
    });
  });
});

describe("daySpotId", () => {
  const path = ["gate", "tree", "files"];
  it("берёт spotId дня, иначе точку пути по кругу", () => {
    expect(daySpotId({ n: 1 }, path)).toBe("gate");
    expect(daySpotId({ n: 3 }, path)).toBe("files");
    expect(daySpotId({ n: 4 }, path)).toBe("gate");
    expect(daySpotId({ n: 5, spotId: "tree" }, path)).toBe("tree");
  });

  it("без пути и без spotId ошибка", () => {
    expect(() => daySpotId({ n: 1 }, [])).toThrow(/path/);
  });
});

describe("пакеты и experience", () => {
  it("квизовый пакет без experience остаётся квизом, demo-office и demo-coffee проходят без правок", () => {
    expect(packSchema.parse(demoCoffee).experience).toBe("quiz");
    expect(anyPackSchema.parse(demoCoffee)).toMatchObject({ experience: "quiz", tenant: "demo-coffee" });
    expect(anyPackSchema.parse(officePack)).toMatchObject({ experience: "quiz", tenant: "demo-office" });
    expect(campaignSchema.safeParse(demoCoffee.campaign).success).toBe(true);
  });

  it("адвент-пакет разбирается и выбирается по experience", () => {
    const parsed = anyPackSchema.parse(adventPackFixture());
    expect(parsed.experience).toBe("advent");
    expect(adventPackSchema.parse(adventPackFixture())).toMatchObject({ demo: false, profile: "horeca" });
  });

  it("адвент-пакет не проходит квизовую схему и наоборот", () => {
    expect(packSchema.safeParse(adventPackFixture()).success).toBe(false);
    expect(adventPackSchema.safeParse(demoCoffee).success).toBe(false);
  });

  it("неизвестный профиль отвергается", () => {
    expect(adventPackSchema.safeParse({ ...adventPackFixture(), profile: "bank" }).success).toBe(false);
    expect(adventPackSchema.safeParse({ ...adventPackFixture(), profile: "custom" }).success).toBe(true);
  });

  it("рантайм загружает и квизы, и адвенты", () => {
    const tenants = loadTenants([demoCoffee, adventPackFixture()]);
    expect(tenants.map((tenant) => tenant.experience)).toEqual(["quiz", "advent"]);
  });
});
