import { describe, expect, it } from "vitest";

import { checkPack } from "@/tools/pack-check";
import demoCoffee from "@tenants/demo-coffee/pack.json" with { type: "json" };

import { adventPackFixture } from "../fixtures/advent";

describe("quiz:check для адвента", () => {
  it("валидный пакет проходит без ошибок; единственное предупреждение — юридический маркер демо-текстов; в отчёте есть симуляция", async () => {
    const report = await checkPack(adventPackFixture());
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("на согласовании юриста");
    expect(report.info.join("\n")).toContain("симуляция, идеальный игрок: открыто 12 из 12");
    expect(report.info.join("\n")).toContain("дней: 12");
  });

  it("ошибки схемы — русские, а не «expected quiz»", async () => {
    const pack = adventPackFixture();
    delete pack.advent.schedule.startDate;
    pack.advent.days.pop();
    const report = await checkPack(pack);
    const text = report.errors.join("\n");
    expect(report.errors.length).toBeGreaterThan(0);
    expect(text).toContain("advent.schedule.startDate");
    expect(text).toContain("Неверный ввод");
    expect(text).not.toContain("expected \"quiz\"");
    expect(text).not.toContain("campaign");
  });

  it("приз дороже 4 000 ₽ — предупреждение про НДФЛ; ровно 4 000 — нет", async () => {
    const pack = adventPackFixture();
    pack.advent.rewards[0].valueRub = 4001;
    pack.advent.rewards[1].valueRub = 4000;
    const report = await checkPack(pack);
    expect(report.errors).toEqual([]);
    expect(report.warnings.filter((line) => line.includes("НДФЛ"))).toHaveLength(1);
    expect(report.warnings.join("\n")).toContain("daily-gift");
  });

  it.each(["Новогодняя Лотерея", "делайте СТАВКИ", "азартная игра", "Азарт!"])("стоп-слово в «%s» — предупреждение", async (text) => {
    const pack = adventPackFixture();
    pack.advent.days[2].teaser = text;
    const report = await checkPack(pack);
    expect(report.warnings.join("\n")).toContain("стоп-слова");
    expect(report.warnings.join("\n")).toContain("days[2].teaser");
  });

  it("слова «поставка» и «заставка» стоп-словами не считаются", async () => {
    const pack = adventPackFixture();
    pack.advent.days[2].teaser = "Поставка зёрен и заставка на экране";
    expect((await checkPack(pack)).warnings.filter((line) => line.includes("стоп-слова"))).toEqual([]);
  });

  it("маркер TODO — ошибка", async () => {
    const pack = adventPackFixture();
    pack.advent.intro = "TODO описание";
    expect((await checkPack(pack)).errors.join("\n")).toContain("TODO");
  });

  it("квиз проверяется как раньше", async () => {
    const report = await checkPack(demoCoffee);
    expect(report.errors).toEqual([]);
    expect(report.info.join("\n")).toContain("зон:");
  });
});
