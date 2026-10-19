import { describe, expect, it } from "vitest";

import { packSchema } from "@/config/pack";
import { applyBrief, parseBrief, toIsoMoscow } from "@/tools/brief";
import { checkPack, knownWorlds } from "@/tools/pack-check";
import { buildTemplate } from "@/tools/template";
import { pack as officePack } from "@tenants/demo-office/pack";

const clone = () => structuredClone(officePack) as unknown as { campaign: Record<string, any>; worldId: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("quiz:check", () => {
  it("эталонный пакет demo-office проходит без ошибок, идеальный проход равен максимуму и даёт высший уровень", async () => {
    const report = await checkPack(officePack);
    expect(report.errors).toEqual([]);
    expect(report.info.join("\n")).toContain("идеальный проход 3775");
    expect(report.warnings.join("\n")).toContain("на согласовании юриста");
  });

  it("заготовка quiz:new валидна по схеме, но блокируется маркерами TODO", async () => {
    const template = buildTemplate({ tenant: "demo-shop" });
    expect(packSchema.safeParse(template).success).toBe(true);
    const report = await checkPack(template);
    expect(report.errors.some((line) => line.includes("TODO"))).toBe(true);
  });

  it("заготовка на 3–5 зон остаётся валидной", () => {
    for (const zones of [3, 4, 5]) expect(packSchema.safeParse(buildTemplate({ tenant: "demo-shop", zones })).success).toBe(true);
  });

  describe("маркеры незаполненного (TODO, FIXME, XXX, ЗАПОЛНИТЬ)", () => {
    const errorsFor = async (edit: (pack: ReturnType<typeof clone>) => void) => {
      const pack = clone();
      edit(pack);
      return (await checkPack(pack)).errors.filter((line) => line.includes("незаполненные"));
    };

    it("ловятся как отдельное слово в текстовых полях, включая кириллицу", async () => {
      for (const text of ["TODO: придумать", "Опишите (XXX) подробнее", "FIXME", "ЗАПОЛНИТЬ позже", "шаг-TODO"]) {
        expect(await errorsFor((pack) => { pack.campaign.rooms[0].description = text; }), text).toHaveLength(1);
      }
    });

    it("не срабатывают внутри слов и в нетекстовых полях (id, ссылки, перечисления)", async () => {
      for (const text of ["MASTODON и TODOS", "Размер XXXL", "ЗАПОЛНИТЬСЯ нечем", "todo, xxx и fixme в нижнем регистре"]) {
        expect(await errorsFor((pack) => { pack.campaign.rooms[0].description = text; }), text).toEqual([]);
      }
      // Идентификаторы с маркером — не «пустое место», их не просматриваем.
      expect(await errorsFor((pack) => { pack.campaign.rooms[0].tasks[0].id = "TODO-first"; pack.campaign.rooms[0].icon = "XXX"; })).toEqual([]);
    });
  });

  it("недостижимый высший уровень — ошибка", async () => {
    const pack = clone();
    pack.campaign.rewardTiers = [
      { minScore: 0, title: "A", description: "", giftLabel: "a" },
      { minScore: 99999, title: "B", description: "", giftLabel: "b" }
    ];
    const report = await checkPack(pack);
    expect(report.errors.join("\n")).toContain("не достигает высшего уровня");
  });

  it("ненулевой нижний порог: нулевой проход не получает нижний уровень", async () => {
    const pack = clone();
    pack.campaign.rewardTiers = [
      { minScore: 0, title: "A", description: "", giftLabel: "a" },
      { minScore: 0, title: "B", description: "", giftLabel: "b" }
    ];
    expect((await checkPack(pack)).errors.length).toBeGreaterThan(0);
  });

  it("неизвестный мир — ошибка; битая схема — ошибка схемы", async () => {
    const world = clone();
    world.worldId = "no-such-world";
    expect((await checkPack(world)).errors.join("\n")).toContain("такого мира нет");

    const broken = clone();
    broken.campaign.brand.colors.bg = "red";
    expect((await checkPack(broken)).errors[0]).toMatch(/^схема:/);
  });

  it("quest на зонах без точек мира — ошибка", async () => {
    const quest = buildTemplate({ tenant: "demo-shop" }) as { campaign: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    quest.campaign.mode = "quest";
    for (const room of quest.campaign.rooms) delete room.spotId;
    expect((await checkPack(quest)).errors.join("\n")).toContain("точки «zone-1» нет в мире");
  });

  it("несуществующий файл логотипа — ошибка, длинный текст — предупреждение", async () => {
    const pack = clone();
    pack.campaign.brand.logo = "/tenants/none/logo.svg";
    pack.campaign.rooms[0].tasks[0].say = "очень длинный текст ".repeat(20);
    const report = await checkPack(pack);
    expect(report.errors.join("\n")).toContain("brand.logo");
    expect(report.warnings.join("\n")).toContain("может не поместиться");
  });

  it("известные миры включают snow-globe", () => {
    expect(knownWorlds()).toContain("snow-globe");
  });
});

describe("разбор брифа", () => {
  const brief = `
# Бриф
- **Название бизнеса:** Кофейня «Зерно»
- Слоган: Кофе, который вас ждёт
- Юрлицо (оператор ПДн): ИП Зернов А. А.
- Домен: https://zerno.example.com/
- Цвет акцента: #8a4b1f
- Цвет фона: красный
- Начало кампании: 20.12.2026
- Приём заявок до: —
- Режим: cards
`;

  it("читает известные ключи и пропускает пустые", () => {
    expect(parseBrief(brief)).toMatchObject({ businessName: "Кофейня «Зерно»", operator: "ИП Зернов А. А.", colorAccent: "#8a4b1f", mode: "cards" });
    expect(parseBrief(brief).claimEndsAt).toBeUndefined();
  });

  it("переносит поля в заготовку и пропускает неверные цвета", () => {
    const pack = buildTemplate({ tenant: "zerno" }) as { hosts: string[]; campaign: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const applied = applyBrief(pack, parseBrief(brief));
    expect(pack.hosts).toEqual(["zerno.example.com"]);
    expect(pack.campaign.brand.colors.accent).toBe("#8a4b1f");
    expect(pack.campaign.brand.colors.bg).toBe("#061024");
    expect(pack.campaign.startsAt).toBe("2026-12-20T00:00:00+03:00");
    expect(applied).toContain("legal.operatorName");
    expect(packSchema.safeParse(pack).success).toBe(true);
  });

  it("даты", () => {
    expect(toIsoMoscow("31.12.2026", true)).toBe("2026-12-31T23:59:59+03:00");
    expect(toIsoMoscow("вчера")).toBeNull();
  });
});

describe("все пакеты манифеста", () => {
  it("проходят quiz:check без ошибок (в том числе демо-кофейня, собранная по скиллу build-quiz)", async () => {
    const { packs } = await import("@tenants/index");
    expect(packs.length).toBeGreaterThanOrEqual(2);
    for (const raw of packs) {
      const report = await checkPack(raw);
      expect(report.errors, (raw as { tenant: string }).tenant).toEqual([]);
    }
  });

  it("демо-кофейня: 3 зоны × 3 задания, идеальный проход даёт высший уровень, тексты не заимствованы из эталонного пакета", async () => {
    const { packs } = await import("@tenants/index");
    const coffee = packs.find((raw) => (raw as { tenant: string }).tenant === "demo-coffee");
    const parsed = packSchema.parse(coffee);
    expect(parsed.campaign.rooms.map((room) => room.tasks.length)).toEqual([3, 3, 3]);
    expect(JSON.stringify(parsed)).not.toMatch(/Северн|demo-office/i);
    const report = await checkPack(coffee);
    expect(report.info.join("\n")).toContain("идеальный проход 2325");
  });
});

describe("привязка зон к точкам мира", () => {
  it("spotId вне мира — ошибка; две зоны на одну точку — ошибка; кнопка не на точке — предупреждение", async () => {
    const unknown = clone();
    unknown.campaign.rooms[0].spotId = "nowhere";
    expect((await checkPack(unknown)).errors.join("\n")).toContain("точки «nowhere»");

    const twice = clone();
    twice.campaign.rooms[1].spotId = twice.campaign.rooms[0].id;
    expect((await checkPack(twice)).errors.join("\n")).toContain("привязаны к одной точке");

    const moved = clone();
    moved.campaign.rooms[0].map = { x: 10, y: 10 };
    expect((await checkPack(moved)).warnings.join("\n")).toContain("не совпадает с точкой");
  });

  it("quest: spotId, не совпадающий с id зоны, поддержан (карта зоны следует за точкой, а не за её id)", async () => {
    const pack = clone();
    pack.campaign.rooms[0].spotId = "calendar";
    pack.campaign.rooms[1].spotId = "mail";
    const report = await checkPack(pack);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join("\n")).toContain("не совпадает с точкой «calendar»");
  });
});
