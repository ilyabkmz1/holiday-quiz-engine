import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PROFILE_IDS } from "@/config/advent-profile";
import { adventPackSchema } from "@/config/pack";
import { dayUnlockAt } from "@/domain/advent";
import { adventChoicesFromBrief, applyAdventBrief, buildAdventTemplate, ADVENT_PROFILE_CHOICES } from "@/tools/advent-template";
import { parseBrief } from "@/tools/brief";
import { checkPack } from "@/tools/pack-check";
import { MARKER, walkStrings } from "@/tools/pack-walk";

describe("buildAdventTemplate", () => {
  it.each(ADVENT_PROFILE_CHOICES)("профиль %s: заготовка проходит схему на 5, 12 и 31 день", (profile) => {
    for (const days of [5, 12, 31]) {
      const pack = buildAdventTemplate({ tenant: "acme", days, profile });
      const parsed = adventPackSchema.safeParse(pack);
      expect(parsed.success, `${profile}/${days}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
      expect(parsed.data?.advent.days).toHaveLength(days);
      expect(parsed.data?.profile).toBe(profile);
      expect(parsed.data?.demo).toBe(false);
    }
  });

  it("тексты автора — «TODO», поэтому quiz:check не выпустит пакет, пока их не заполнят", async () => {
    const pack = buildAdventTemplate({ tenant: "acme", days: 12, profile: "horeca" });
    const markers: string[] = [];
    walkStrings(pack, "", (where, text) => {
      if (MARKER.test(text)) markers.push(where);
    });
    expect(markers).toContain("advent.title");
    expect(markers).toContain("advent.days[0].title");
    expect(markers).toContain("advent.days[11].chapter.lines[0]");
    const report = await checkPack(pack);
    expect(report.errors.join("\n")).toContain("TODO");
  });

  it("значения профиля подмешаны: догоняние, награды, цели пересчитаны под число дней", () => {
    const horeca = buildAdventTemplate({ tenant: "acme", days: 12, profile: "horeca" });
    const parsed = adventPackSchema.parse(horeca).advent;
    expect(parsed.schedule.catchUp).toEqual({ window: 1 });
    expect(parsed.rewards.map((reward) => reward.id)).toContain("daily-gift");
    expect(parsed.streak.goals).toEqual([{ opened: 4, rewardId: "goal-gift" }, { opened: 8, rewardId: "final-entry" }]);
    const long = adventPackSchema.parse(buildAdventTemplate({ tenant: "acme", days: 31, profile: "horeca" })).advent;
    expect(long.streak.goals.map((goal) => goal.opened)).toEqual([11, 21]);
    expect(adventPackSchema.parse(buildAdventTemplate({ tenant: "acme", days: 12, profile: "b2b" })).advent.schedule).toMatchObject({ catchUp: "all", unlockHour: 9 });
  });

  it("финал через сутки после открытия последнего дня, выдача кодов — через 13 суток после финала", () => {
    for (const profile of PROFILE_IDS) {
      const { advent } = adventPackSchema.parse(buildAdventTemplate({ tenant: "acme", days: 12, profile, startDate: "2026-12-20" }));
      const last = dayUnlockAt(12, advent.schedule).getTime();
      expect(new Date(advent.schedule.finaleAt).getTime() - last, profile).toBe(24 * 3_600_000);
      expect(new Date(advent.schedule.claimEndsAt).getTime()).toBeGreaterThan(new Date(advent.schedule.finaleAt).getTime());
    }
  });

  it("удача: на каждом четвёртом дне, пул с утешительным призом без остатка; награда дня — не на дне удачи", () => {
    const { advent } = adventPackSchema.parse(buildAdventTemplate({ tenant: "acme", days: 12, profile: "retail" }));
    const luckDays = advent.days.filter((day) => day.blocks.some((block) => block.type === "luck")).map((day) => day.n);
    expect(luckDays).toEqual([4, 8, 12]);
    for (const day of advent.days) {
      expect(day.blocks.length).toBeLessThanOrEqual(3);
      expect(day.rewardId === undefined).toBe(luckDays.includes(day.n));
    }
    const noLuck = adventPackSchema.parse(buildAdventTemplate({ tenant: "acme", days: 12, profile: "custom" })).advent;
    expect(noLuck.luck).toBeUndefined();
    expect(noLuck.days.some((day) => day.blocks.some((block) => block.type === "luck"))).toBe(false);
  });

  it("награды с погашением на сайте получают адрес-маркер TODO (retail, beauty)", () => {
    for (const profile of ["retail", "beauty"] as const) {
      const rewards = (buildAdventTemplate({ tenant: "shop", days: 12, profile }) as { advent: { rewards: Array<{ redeem: string; url?: string }> } }).advent.rewards;
      for (const reward of rewards.filter((item) => item.redeem === "online" || item.redeem === "both")) expect(reward.url, profile).toMatch(MARKER);
    }
  });

  it("corporate: команды для рейтинга заготовлены (TODO), промокодов нет", () => {
    const { advent } = adventPackSchema.parse(buildAdventTemplate({ tenant: "acme", days: 12, profile: "corporate" }));
    expect(advent.audience).toMatchObject({ kind: "employees", leaderboard: "teams" });
    expect(advent.audience.teams?.map((team) => team.id)).toEqual(["team-1", "team-2"]);
    expect(advent.rewards.some((reward) => reward.kind === "promo")).toBe(false);
  });

  it("недопустимое число дней отвергается", () => {
    for (const days of [4, 32, 12.5, Number.NaN]) expect(() => buildAdventTemplate({ tenant: "acme", days, profile: "retail" })).toThrow(/Число дней/);
  });
});

describe("«Витрина» в заготовке адвента", () => {
  it.each([["horeca", "cafe"], ["retail", "shop"], ["b2b", "office"], ["corporate", "office"], ["beauty", "salon"], ["custom", "shop"]] as const)(
    "профиль %s: вид storefront, фасад %s и хозяин у двери — первый герой",
    (profile, template) => {
      const { advent } = adventPackSchema.parse(buildAdventTemplate({ tenant: "acme", days: 12, profile }));
      expect(advent.presentation).toBe("storefront");
      expect(advent.facade).toEqual({ templateId: template, hostHeroId: "hero-1" });
    }
  );

  it("quiz:check пропускает фасад заготовки и ловит неизвестный шаблон", async () => {
    const pack = buildAdventTemplate({ tenant: "acme", days: 12, profile: "horeca" }) as { advent: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await checkPack(structuredClone(pack))).errors.join("\n")).not.toMatch(/facade/);
    pack.advent.facade.templateId = "castle";
    expect((await checkPack(pack)).errors.join("\n")).toMatch(/facade\.templateId «castle»: такого фасада нет \(доступны: .*cafe/);
  });

  it("бриф: «Вид», «Фасад» и «Вывеска» переопределяют профиль", () => {
    const pack = buildAdventTemplate({ tenant: "acme", days: 12, profile: "horeca" }) as { hosts: string[]; advent: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const applied = applyAdventBrief(pack, parseBrief("- Вид (storefront / calendar): storefront\n- Фасад (cafe, shop, office, salon): salon\n- Вывеска (до 28 символов): Белый лотос"));
    expect(applied).toEqual(expect.arrayContaining(["presentation", "facade.templateId", "facade.signText"]));
    expect(adventPackSchema.parse(pack).advent.facade).toEqual({ templateId: "salon", hostHeroId: "hero-1", signText: "Белый лотос" });
  });

  it("шаблон брифа знает поля «Фасад» и «Вывеска»", () => {
    const template = readFileSync("docs/brief-template.md", "utf8")
      .replace(/^- Фасад \(([^\n]*)\):\s*$/m, "- Фасад ($1): office")
      .replace(/^- Вывеска \(([^\n]*)\):\s*$/m, "- Вывеска ($1): Маяк");
    const fields = parseBrief(template);
    expect(fields.adventFacade?.trim()).toBe("office");
    expect(fields.adventSign?.trim()).toBe("Маяк");
  });
});

describe("перенос брифа в заготовку адвента", () => {
  const brief = `
- Название бизнеса: Кофейня «Зерно»
- Юрлицо (оператор персональных данных): ООО «Зерно»
- Домен: https://advent.zerno.example/
- Название квиза: Адвент «Зерна»
- Цвет акцента (#RRGGBB, цвет кнопок): #a85a15
- Тип бизнеса (retail, horeca, beauty, b2b, corporate): horeca
- Количество дней (5–31, рекомендуем 12): 14
- Первый день (ДД.ММ.ГГГГ): 18.12.2026
- Час открытия нового дня (0–23, по умолчанию 0): 8
- Догнать пропущенные дни (нет / 1–7 дней / все): за 3 дня
- Приз дня только в свой день (да / нет): да
- Вид (calendar / world): calendar
- Финал (ДД.ММ.ГГГГ): 02.01.2027
- Выдача кодов до (ДД.ММ.ГГГГ): 20.01.2027
- Заморозки серии (0–3): 2
- Подаренный день старта (да / нет): нет
- Удача (boxes, wheel, scratch или нет): wheel
- Напоминания на email (да / нет): да
- Время напоминаний (ЧЧ:ММ): 09:30
- Тема письма-напоминания ({day}, {teaser}): Окно {day}: {teaser}
- Тема письма-возвращения: Мы скучали по вам в «Зерне» — окно {day}
- Абзац письма-возвращения: Вчера вы заглянули не к нам. Сегодня ждём!
- Реквизиты оператора: ИНН 7700000000, Москва
- Кто играет (customers / employees): customers
- Ожидаемое число участников: 1 500
- Нужна ли покупка для участия (да / нет): да
`;

  function build() {
    const fields = parseBrief(brief);
    const choices = adventChoicesFromBrief(fields);
    const pack = buildAdventTemplate({ tenant: "zerno", days: choices.days!, profile: choices.profile!, startDate: choices.startDate }) as { hosts: string[]; advent: Record<string, any>; expectedParticipants?: number }; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { pack, applied: applyAdventBrief(pack, fields) };
  }

  it("профиль, число дней и дата старта читаются до сборки заготовки", () => {
    expect(adventChoicesFromBrief(parseBrief(brief))).toEqual({ profile: "horeca", days: 14, startDate: "2026-12-18" });
    expect(adventChoicesFromBrief(parseBrief("- Количество дней: 40\n- Тип бизнеса: ресторан"))).toEqual({});
  });

  it("поля раздела «Адвент» переносятся в пакет и пакет остаётся валидным", () => {
    const { pack, applied } = build();
    const advent = adventPackSchema.parse(pack).advent;
    expect(advent.schedule).toMatchObject({ days: 14, startDate: "2026-12-18", unlockHour: 8, catchUp: { window: 3 }, rewardOnlyOnDay: true });
    expect(advent.schedule.finaleAt).toBe("2027-01-02T08:00:00+03:00");
    expect(advent.schedule.claimEndsAt).toBe("2027-01-20T23:59:59+03:00");
    expect(advent.streak).toMatchObject({ freezes: 2, endowedDay: false });
    expect(advent.luck?.skin).toBe("wheel");
    expect(advent.reminders).toMatchObject({
      channel: "email",
      sendAtLocal: "09:30",
      subject: "Окно {day}: {teaser}",
      comebackSubject: "Мы скучали по вам в «Зерне» — окно {day}",
      comebackText: "Вчера вы заглянули не к нам. Сегодня ждём!"
    });
    expect(advent.legal.operatorDetails).toBe("ИНН 7700000000, Москва");
    expect(advent.rules.requiresPurchase).toBe(true);
    expect(advent.brand.name).toBe("Кофейня «Зерно»");
    expect(advent.legal.operatorName).toBe("ООО «Зерно»");
    expect(advent.title).toBe("Адвент «Зерна»");
    expect(advent.brand.colors.accent).toBe("#a85a15");
    expect(pack.hosts).toEqual(["advent.zerno.example"]);
    expect(pack.expectedParticipants).toBe(1500);
    for (const field of ["schedule.unlockHour", "schedule.catchUp", "schedule.finaleAt", "streak.freezes", "luck.skin", "reminders.sendAtLocal", "expectedParticipants", "rules.requiresPurchase", "hosts"]) {
      expect(applied, field).toContain(field);
    }
    // Даты квиза и режим карточек в адвент не попадают.
    expect(advent).not.toHaveProperty("startsAt");
    expect(advent).not.toHaveProperty("mode");
  });

  it("час открытия из брифа без даты финала: финал всё равно через сутки после открытия последнего дня", () => {
    const pack = buildAdventTemplate({ tenant: "zerno", days: 12, profile: "horeca" }) as { hosts: string[]; advent: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    applyAdventBrief(pack, parseBrief("- Час открытия нового дня (0–23, по умолчанию 0): 10"));
    expect(adventPackSchema.parse(pack).advent.schedule).toMatchObject({ unlockHour: 10, finaleAt: "2027-01-01T10:00:00+03:00" });
  });

  it("шаблон брифа: свободная строка про призы удачи не затирает скин удачи", () => {
    const template = readFileSync("docs/brief-template.md", "utf8").replace(/^- Удача \(boxes[^\n]*$/m, (line) => `${line} wheel`);
    expect(parseBrief(template).adventLuck?.trim()).toBe("wheel");
  });

  it("«Удача: нет» убирает секцию luck и блоки удачи (их заменяют задания)", () => {
    const pack = buildAdventTemplate({ tenant: "zerno", days: 12, profile: "retail" }) as { hosts: string[]; advent: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    applyAdventBrief(pack, parseBrief("- Удача: нет"));
    const advent = adventPackSchema.parse(pack).advent;
    expect(advent.luck).toBeUndefined();
    expect(advent.days.some((day) => day.blocks.some((block) => block.type === "luck"))).toBe(false);
    expect(advent.days.every((day) => day.rewardId !== undefined)).toBe(true);
  });

  it("рейтинг команд: названия команд из брифа", () => {
    const pack = buildAdventTemplate({ tenant: "zerno", days: 12, profile: "corporate" }) as { hosts: string[]; advent: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    applyAdventBrief(pack, parseBrief("- Команды: Север, Юг; Восток"));
    expect(adventPackSchema.parse(pack).advent.audience.teams).toEqual([
      { id: "team-1", title: "Север" },
      { id: "team-2", title: "Юг" },
      { id: "team-3", title: "Восток" }
    ]);
  });

  it("нераспознанные и пустые значения пропускаются, значения по умолчанию профиля остаются", () => {
    const pack = buildAdventTemplate({ tenant: "zerno", days: 12, profile: "horeca" }) as { hosts: string[]; advent: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const before = structuredClone(pack.advent.schedule);
    const applied = applyAdventBrief(pack, parseBrief("- Час открытия нового дня: 25\n- Догнать пропущенные дни: —\n- Заморозки серии: пять\n- Вид: карта"));
    expect(applied).toEqual([]);
    expect(pack.advent.schedule).toEqual(before);
  });
});
