import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// @ts-expect-error — .mjs без типов: скрипт сборки образа
import { selectPacks } from "../../scripts/select-packs.mjs";

const source = readFileSync("tenants/index.ts", "utf8");
type Selected = { text: string; available: string[] };
const select = (wanted: string[]) => selectPacks(source, wanted) as Selected;

describe("select-packs (образ только с нужными пакетами)", () => {
  it("оставляет только выбранный пакет: второй пакет не попадает в боевой образ клиента", () => {
    const { text, available } = select(["demo-office"]);
    expect(available).toEqual(expect.arrayContaining(["demo-office", "demo-coffee"]));
    expect(text).toContain('"./demo-office/pack"');
    expect(text).not.toContain("demo-coffee");
    expect(text).not.toContain("demoCoffee");
    // Маркеры quiz:new для следующих пакетов остаются на месте.
    expect(text).toContain("// quiz:new-import");
    expect(text).toContain("// quiz:new-append");
  });

  it("несколько пакетов и неизвестный slug", () => {
    const both = select(["demo-office", "demo-coffee"]).text;
    expect(both).toContain("demoOffice,");
    expect(both).toContain("demoCoffee,");
    expect(() => selectPacks(source, ["no-such"])).toThrow(/не найдены/);
  });

  it("результат — рабочий манифест из одного пакета", async () => {
    const { text } = select(["demo-coffee"]);
    expect(text).toContain("demoCoffee,");
    expect(text).not.toContain("demoOffice");
  });
});
