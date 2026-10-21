import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PROFILE_IDS } from "@/config/advent-profile";
import { facadeContrastIssues, facadeSchema, facadeChoiceSchema, FACADE_TOKENS, parseFacade } from "@/config/facade";
import { deriveTheme } from "@/config/theme";
import { facadeIds, loadFacade, overrideFacades } from "@/facades/registry";
import { rawFacades } from "@facades/index";
import { rawProfiles } from "@profiles/index";
import { packs } from "@tenants/index";

import { adventConfig } from "../support/advent";

afterEach(() => overrideFacades(null));

describe("библиотека фасадов", () => {
  it("в манифесте пять шаблонов: cafe, shop, office, salon, datacenter", () => {
    expect(facadeIds().sort()).toEqual(["cafe", "datacenter", "office", "salon", "shop"]);
  });

  it("каждая папка facades/<id>/ внесена в манифест и наоборот", () => {
    const dir = path.join(process.cwd(), "facades");
    const folders = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    expect(folders).toEqual(Object.keys(rawFacades).sort());
  });

  it("каждый шаблон проходит схему, id совпадает с ключом манифеста", () => {
    for (const [id, raw] of Object.entries(rawFacades)) {
      expect(parseFacade(raw).id).toBe(id);
      expect(loadFacade(id).id).toBe(id);
    }
  });

  it("формы: cafe — двускатная и арки, shop — плоская с маркизой и прямоугольные витрины, office — плоская и панорама, salon — купол и круглые окна, datacenter — охлаждение, юниты и гермодверь", () => {
    expect(loadFacade("cafe")).toMatchObject({ roof: { shape: "gable" }, windows: { shape: "arch" }, vessel: "cup" });
    expect(loadFacade("shop")).toMatchObject({ roof: { shape: "flat", awning: true }, windows: { shape: "square" } });
    expect(loadFacade("office")).toMatchObject({ roof: { shape: "flat", awning: false }, windows: { shape: "square", panes: "panorama" } });
    expect(loadFacade("salon")).toMatchObject({ roof: { shape: "dome" }, windows: { shape: "round" }, door: { shape: "round" } });
    expect(loadFacade("datacenter")).toMatchObject({ roof: { shape: "cooling" }, windows: { shape: "unit" }, door: { shape: "hatch" }, layout: { columns: 2 }, vessel: "stack" });
  });

  it("datacenter: общий шаблон без бренда, колонок по умолчанию 4, лишние значения колонок отвергаются", () => {
    const text = readFileSync(path.join(process.cwd(), "facades", "datacenter", "facade.json"), "utf8");
    expect(text).not.toMatch(/https?:|vk|mail\.ru|yandex|selectel/i);
    expect(loadFacade("cafe").layout.columns).toBe(4);
    const draft = structuredClone(rawFacades.datacenter) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(facadeSchema.safeParse(draft).success).toBe(true);
    draft.layout.columns = 3;
    expect(facadeSchema.safeParse(draft).success).toBe(false);
  });

  it("цвета — только имена токенов бренда: в шаблонах нет ни hex, ни rgb()", () => {
    const dir = path.join(process.cwd(), "facades");
    for (const id of Object.keys(rawFacades)) {
      const text = readFileSync(path.join(dir, id, "facade.json"), "utf8");
      expect(text.match(/#[0-9a-fA-F]{3,8}\b/g), `${id}: hex`).toBeNull();
      expect(text.match(/\b(?:rgba?|hsla?)\(/g), `${id}: цвет-функция`).toBeNull();
    }
    for (const id of facadeIds()) {
      for (const token of Object.values(loadFacade(id).colors)) expect(FACADE_TOKENS).toContain(token);
    }
  });

  it("схема отвергает hex вместо токена, неизвестную форму и лишние поля", () => {
    const base = structuredClone(rawFacades.cafe) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const bad = (patch: (draft: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const draft = structuredClone(base);
      patch(draft);
      return facadeSchema.safeParse(draft).success;
    };
    expect(bad(() => undefined)).toBe(true);
    expect(bad((draft) => { draft.colors.wall = "#ff0000"; })).toBe(false);
    expect(bad((draft) => { draft.colors.wall = "not-a-token"; })).toBe(false);
    expect(bad((draft) => { draft.roof.shape = "pyramid"; })).toBe(false);
    expect(bad((draft) => { draft.windows.shape = "triangle"; })).toBe(false);
    expect(bad((draft) => { draft.door.shape = "hexagon"; })).toBe(false);
    expect(bad((draft) => { draft.extra = 1; })).toBe(false);
    expect(bad((draft) => { delete draft.colors.glow; })).toBe(false);
    expect(bad((draft) => { draft.id = "Cafe Bar"; })).toBe(false);
  });

  it("неизвестный фасад: понятная ошибка со списком доступных", () => {
    expect(() => loadFacade("castle")).toThrow(/не найден.*cafe/);
  });

  it("фасад-фикстура подключается через overrideFacades; id обязан совпасть с ключом", () => {
    const fixture = { ...(rawFacades.cafe as object), id: "fixture" };
    overrideFacades({ fixture });
    expect(loadFacade("fixture").id).toBe("fixture");
    overrideFacades({ other: fixture });
    expect(() => loadFacade("other")).toThrow(/не совпадает/);
  });

  it("цифры читаются (контраст ≥ 4,5) на палитре каждого демо-пакета и на палитре заготовки quiz:new", () => {
    const palettes: Array<[string, Record<string, string>, object | undefined]> = [
      ["заготовка", { bg: "#061024", panel: "#0b1836", ink: "#eef3ff", accent: "#1a62e8", accent2: "#62e0ff", highlight: "#ffcb5c", danger: "#ff8a7a", success: "#6ee7a8" }, undefined]
    ];
    for (const pack of packs as Array<{ tenant: string; advent?: { brand: { colors: Record<string, string>; derived?: object } }; campaign?: { brand: { colors: Record<string, string>; derived?: object } } }>) {
      const brand = pack.advent?.brand ?? pack.campaign?.brand;
      if (brand) palettes.push([pack.tenant, brand.colors, brand.derived]);
    }
    expect(palettes.length).toBeGreaterThan(4);
    for (const [name, colors, derived] of palettes) {
      for (const id of facadeIds()) {
        expect(facadeContrastIssues(loadFacade(id), deriveTheme(colors as never, (derived ?? {}) as never)), `${name} × ${id}`).toEqual([]);
      }
    }
  });

  it("datacenter: цифра на плашке юнита читается на палитрах всех демо-пакетов, а светлая цифра на светящейся плашке ловится", () => {
    const datacenter = loadFacade("datacenter");
    for (const pack of packs as Array<{ tenant: string; advent?: { brand: { colors: Record<string, string>; derived?: object } }; campaign?: { brand: { colors: Record<string, string>; derived?: object } } }>) {
      const brand = pack.advent?.brand ?? pack.campaign?.brand;
      if (brand) expect(facadeContrastIssues(datacenter, deriveTheme(brand.colors as never, (brand.derived ?? {}) as never)), pack.tenant).toEqual([]);
    }
    const theme = deriveTheme({ bg: "#061024", panel: "#0b1836", ink: "#eef3ff", accent: "#1a62e8", accent2: "#62e0ff", highlight: "#ffcb5c", danger: "#ff8a7a", success: "#6ee7a8" });
    const washedOut = { ...datacenter, colors: { ...datacenter.colors, glowInk: "ink" as const } };
    expect(facadeContrastIssues(washedOut, theme).join("\n")).toMatch(/цифра на свете открытого окна/);
  });

  it("контраст-проверка ловит светлое стекло под светлой цифрой", () => {
    const light = { ...loadFacade("cafe"), colors: { ...loadFacade("cafe").colors, glass: "paper" as const } };
    const theme = deriveTheme({ bg: "#061024", panel: "#0b1836", ink: "#eef3ff", accent: "#1a62e8", accent2: "#62e0ff", highlight: "#ffcb5c", danger: "#ff8a7a", success: "#6ee7a8" });
    expect(facadeContrastIssues(light, theme).join("\n")).toMatch(/цифра на стекле закрытого окна/);
  });
});

describe("выбор фасада в пакете", () => {
  it("профили ставят фасад по типу бизнеса: horeca — cafe, retail — shop, b2b и corporate — office, beauty — salon", () => {
    const expected: Record<string, string> = { horeca: "cafe", retail: "shop", b2b: "office", corporate: "office", beauty: "salon" };
    for (const id of PROFILE_IDS) {
      const profile = rawProfiles[id] as { presentation: string; facade: { templateId: string } };
      expect(profile.presentation, id).toBe("storefront");
      expect(profile.facade.templateId, id).toBe(expected[id]);
      expect(facadeIds()).toContain(profile.facade.templateId);
    }
  });

  it("choice: templateId обязателен, вывеска до 28 символов, лишние поля отвергаются", () => {
    expect(facadeChoiceSchema.safeParse({ templateId: "cafe" }).success).toBe(true);
    expect(facadeChoiceSchema.safeParse({ templateId: "cafe", hostHeroId: "mila", signText: "Зерно" }).success).toBe(true);
    expect(facadeChoiceSchema.safeParse({}).success).toBe(false);
    expect(facadeChoiceSchema.safeParse({ templateId: "cafe", signText: "x".repeat(29) }).success).toBe(false);
    expect(facadeChoiceSchema.safeParse({ templateId: "cafe", color: "red" }).success).toBe(false);
  });

  it("presentation: storefront требует facade; hostHeroId должен быть среди героев", () => {
    expect(() => adventConfig((draft) => { draft.presentation = "storefront"; })).toThrow(/требует секцию facade/);
    const ok = adventConfig((draft) => {
      draft.presentation = "storefront";
      draft.facade = { templateId: "cafe", hostHeroId: draft.heroes[0].id };
    });
    expect(ok.facade?.templateId).toBe("cafe");
    expect(() => adventConfig((draft) => {
      draft.presentation = "storefront";
      draft.facade = { templateId: "cafe", hostHeroId: "nobody" };
    })).toThrow(/Неизвестный герой-хозяин/);
  });

  it("calendar без facade работает как раньше", () => {
    expect(adventConfig().presentation).toBe("calendar");
    expect(adventConfig().facade).toBeUndefined();
  });

  it("значок награды — из закрытого списка", () => {
    expect(adventConfig((draft) => { draft.rewards[0].icon = "cup"; }).rewards[0].icon).toBe("cup");
    expect(() => adventConfig((draft) => { draft.rewards[0].icon = "bomb"; })).toThrow();
  });
});
