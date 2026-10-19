/* eslint-disable @typescript-eslint/no-explicit-any -- пакет собирается из слабо типизированной фикстуры и ломается по полям */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { adventConfig } from "../support/advent";
import { simulateAdvent } from "@/tools/advent-sim";
import { checkPack } from "@/tools/pack-check";

import { adventPackFixture } from "../fixtures/advent";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tenantDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "advent-check-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const pack = (patch: (draft: any) => void = () => undefined) => {
  const draft = adventPackFixture();
  patch(draft);
  return draft;
};
const errors = async (draft: any, options = {}) => (await checkPack(draft, { tenantDir: tenantDir(), ...options })).errors.join("\n");
const warnings = async (draft: any, options = {}) => (await checkPack(draft, { tenantDir: tenantDir(), ...options })).warnings.join("\n");

describe("quiz:check для адвента: юридические проверки", () => {
  it.each(["Приз — красное вино", "Дегустация ПИВА", "кальян в подарок", "скидка на сигареты", "ТАБАЧНАЯ лавка", "водка для гостей", "алкоголь", "виски и коньяк"])("алкоголь и табак — ошибка: «%s»", async (text) => {
    const result = await errors(pack((draft) => (draft.advent.days[1].teaser = text)));
    expect(result).toContain("алкоголь и табак");
    expect(result).toContain("days[1].teaser");
  });

  it.each(["Он не виноват", "Виноград и вина нет", "Вина не признал", "Расписание: вторник", "Тимур любит обжарку"])("слова без алкоголя — не ошибка: «%s»", async (text) => {
    expect(await errors(pack((draft) => (draft.advent.days[1].teaser = text)))).not.toContain("алкоголь");
  });

  it("demo: true на боевом адресе — предупреждение; на localhost, .test и без адреса — нет", async () => {
    expect(await warnings(pack((draft) => { draft.demo = true; draft.hosts = ["advent.shop.example.com"]; }))).toContain("demo: true");
    for (const hosts of [["demo.localhost:3000"], ["advent.zerno.test"], []]) {
      expect(await warnings(pack((draft) => { draft.demo = true; draft.hosts = hosts; })), hosts.join()).not.toContain("demo: true");
    }
    expect(await warnings(pack((draft) => { draft.demo = false; draft.hosts = ["advent.shop.example.com"]; }))).not.toContain("demo: true");
  });

  it("покупка для участия: без rules.md — ошибка про ст. 9 38-ФЗ; с rules.md — нет; с пометкой «требует утверждения» — предупреждение", async () => {
    const draft = pack((value) => (value.advent.rules = { requiresPurchase: true }));
    const missing = await errors(draft);
    expect(missing).toContain("ст. 9 38-ФЗ");
    expect(missing).toContain("rules.md");
    const approved = tenantDir({ "rules.md": "# Правила акции\n\nУтверждено юристом." });
    expect((await checkPack(draft, { tenantDir: approved })).errors.join("\n")).not.toContain("38-ФЗ");
    const pending = tenantDir({ "rules.md": "# Правила\n\nТРЕБУЕТ УТВЕРЖДЕНИЯ ЮРИСТОМ ЗАКАЗЧИКА" });
    const report = await checkPack(draft, { tenantDir: pending });
    expect(report.errors.join("\n")).not.toContain("38-ФЗ");
    expect(report.warnings.join("\n")).toContain("не утверждены");
    expect(await errors(pack())).not.toContain("38-ФЗ");
  });
});

describe("quiz:check для адвента: награды", () => {
  it("промокод без codes — ошибка", async () => {
    const result = await errors(pack((draft) => {
      draft.advent.rewards.push({ id: "bare-promo", kind: "promo", label: "Скидка", description: "", redeem: "cashier" });
    }));
    expect(result).toContain("награда bare-promo");
    expect(result).toContain("без codes");
  });

  it("online и both без url — ошибка; с url — нет", async () => {
    const reward = (extra: object) => ({ id: "web-gift", kind: "gift", label: "Подарок", description: "", codes: { static: "WEB" }, validDays: 3, redeem: "online", ...extra });
    expect(await errors(pack((draft) => draft.advent.rewards.push(reward({}))))).toContain("web-gift: погашение online без url");
    expect(await errors(pack((draft) => draft.advent.rewards.push(reward({ redeem: "both" }))))).toContain("web-gift: погашение both без url");
    expect(await errors(pack((draft) => draft.advent.rewards.push(reward({ url: "https://shop.example/promo" }))))).not.toContain("web-gift");
  });

  it("предупреждения: промокод с redeem none, код без срока", async () => {
    const result = await warnings(pack((draft) => {
      draft.advent.rewards.push({ id: "odd-promo", kind: "promo", label: "Скидка", description: "", codes: { static: "ODD" }, validDays: 2, redeem: "none" });
      draft.advent.rewards.push({ id: "eternal", kind: "gift", label: "Вечный", description: "", codes: { static: "ETERNAL" }, redeem: "cashier" });
    }));
    expect(result).toContain("odd-promo: промокод с redeem: none");
    expect(result).toContain("eternal: у кода нет срока");
  });
});

describe("quiz:check для адвента: запас кодов из списков", () => {
  const withList = (draft: any) => {
    draft.advent.rewards[0].codes = { list: "codes/daily-gift.csv" };
  };
  const csv = (count: number, header = true) => `${header ? "code\n" : ""}${Array.from({ length: count }, (_, index) => `ZR${String(index).padStart(4, "0")}`).join("\n")}\n`;

  it("список не найден — предупреждение с подсказкой про админку", async () => {
    expect(await warnings(pack(withList))).toContain("не найден в пакете");
  });

  it("число участников не задано — предупреждение; задано в пакете или флагом — сверка", async () => {
    const dir = tenantDir({ "codes/daily-gift.csv": csv(5000) });
    expect((await checkPack(pack(withList), { tenantDir: dir })).warnings.join("\n")).toContain("ожидаемое число участников не задано");
    const fromPack = await checkPack(pack((draft) => { withList(draft); draft.expectedParticipants = 100; }), { tenantDir: dir });
    expect(fromPack.warnings.join("\n")).not.toContain("не задано");
    expect(fromPack.info.join("\n")).toContain("кодов 5000, нужно до");
    const fromFlag = await checkPack(pack(withList), { tenantDir: dir, expectedParticipants: 100 });
    expect(fromFlag.errors).toEqual([]);
  });

  it("кодов меньше, чем участников × выдач, — ошибка; флаг важнее поля пакета", async () => {
    // daily-gift выдаётся за 9 дней из 12 (без дней удачи), значит на 100 участников нужно до 900 кодов.
    const dir = tenantDir({ "codes/daily-gift.csv": csv(500) });
    const short = await checkPack(pack((draft) => { withList(draft); draft.expectedParticipants = 100; }), { tenantDir: dir });
    expect(short.errors.join("\n")).toContain("кодов 500, а нужно до 900 (100 участников × до 9 выдач)");
    const flag = await checkPack(pack((draft) => { withList(draft); draft.expectedParticipants = 100; }), { tenantDir: dir, expectedParticipants: 10 });
    expect(flag.errors).toEqual([]);
  });

  it("повторы и пустые строки не считаются кодами", async () => {
    const dir = tenantDir({ "codes/daily-gift.csv": "code\nAAA\naaa\n\nBBB\r\n" });
    const report = await checkPack(pack((draft) => { withList(draft); draft.expectedParticipants = 1; }), { tenantDir: dir });
    expect(report.info.join("\n")).toContain("кодов 2,");
  });

  it("для награды с остатком нужно не больше остатка", async () => {
    const dir = tenantDir({ "codes/luck-b.csv": csv(30) });
    const report = await checkPack(pack((draft) => {
      draft.advent.rewards.find((reward: any) => reward.id === "luck-b").codes = { list: "codes/luck-b.csv" };
      draft.expectedParticipants = 1000;
    }), { tenantDir: dir });
    expect(report.errors).toEqual([]);
    expect(report.info.join("\n")).toContain("luck-b: кодов 30, нужно до 30");
  });
});

describe("quiz:check для адвента: расписание, аудитория, мир", () => {
  it("финал раньше чем через 24 часа после открытия последнего дня — предупреждение", async () => {
    // Последний день открывается 31.12 в 00:00 МСК: финал в 12:00 того же дня.
    const result = await warnings(pack((draft) => (draft.advent.schedule.finaleAt = "2026-12-31T12:00:00+03:00")));
    expect(result).toContain("12.0 ч после открытия последнего дня");
    expect(await warnings(pack((draft) => (draft.advent.schedule.finaleAt = "2027-01-01T00:00:00+03:00")))).not.toContain("после открытия последнего дня");
  });

  it("рейтинг команд для клиентов — ошибка; для сотрудников — нет", async () => {
    const teams = [{ id: "a", title: "А" }, { id: "b", title: "Б" }];
    expect(await errors(pack((draft) => (draft.advent.audience = { kind: "customers", leaderboard: "teams", teams })))).toContain("leaderboard: teams");
    expect(await errors(pack((draft) => (draft.advent.audience = { kind: "employees", leaderboard: "teams", teams })))).not.toContain("leaderboard: teams");
  });

  it("мир: неизвестный worldId и несуществующая точка дня — ошибки", async () => {
    expect(await errors(pack((draft) => (draft.worldId = "no-such-world")))).toContain("такого мира нет");
    const result = await errors(pack((draft) => (draft.advent.days[2].spotId = "no-such-spot")));
    expect(result).toContain("день 3: точки «no-such-spot» нет в мире snow-globe");
    expect(await errors(pack((draft) => (draft.advent.days[2].spotId = "mail")))).not.toContain("точки");
  });

  it("presentation: world без path у мира и без spotId у дней — предупреждение; с spotId на каждый день — нет", async () => {
    expect(await warnings(pack((draft) => (draft.advent.presentation = "world")))).toContain("у мира snow-globe нет path");
    const spots = ["projects", "mail", "files", "calendar", "messenger"];
    const result = await warnings(pack((draft) => {
      draft.advent.presentation = "world";
      draft.advent.days.forEach((day: any, index: number) => (day.spotId = spots[index % spots.length]));
    }));
    expect(result).not.toContain("нет path");
    expect(await warnings(pack())).not.toContain("нет path");
  });

  it("логотип, которого нет в public/, — ошибка", async () => {
    expect(await errors(pack((draft) => (draft.advent.brand.logo = "/tenants/none/logo.svg")))).toContain("brand.logo");
  });
});

describe("симуляция трёх игроков", () => {
  it("демо-кофейня: идеальный игрок проходит всё, с пропусками открывает 8 дней, догоняющий — последний и предпоследний", async () => {
    const sim = await simulateAdvent(adventConfig());
    expect(sim.perfect).toMatchObject({ opened: 12, completed: 12, bestStreak: 12, goalsReached: 2, goalsTotal: 2, errors: [] });
    expect(sim.perfect.grants).toBeGreaterThanOrEqual(12);
    expect(sim.skipping).toMatchObject({ opened: 8, completed: 8, errors: [] });
    expect(sim.skipping.bestStreak).toBeLessThan(12);
    expect(sim.catchUp).toMatchObject({ opened: 2, completed: 2, errors: [] });
  });

  it("догоняние «all» открывает все двери", async () => {
    const sim = await simulateAdvent(adventConfig((draft) => (draft.schedule.catchUp = "all")));
    expect(sim.catchUp).toMatchObject({ opened: 12, completed: 12, errors: [] });
    const none = await simulateAdvent(adventConfig((draft) => (draft.schedule.catchUp = "none")));
    expect(none.catchUp).toMatchObject({ opened: 1, completed: 1 });
  });

  it("симуляция детерминирована: два прогона дают один результат", async () => {
    const advent = adventConfig();
    expect(await simulateAdvent(advent)).toEqual(await simulateAdvent(advent));
  });

  it("отчёт quiz:check содержит три строки симуляции", async () => {
    const report = await checkPack(adventPackFixture());
    const info = report.info.join("\n");
    expect(info).toContain("идеальный игрок: открыто 12 из 12");
    expect(info).toContain("игрок с пропусками");
    expect(info).toContain("догоняющий (пришёл в последний день): открыто 2 из 12");
  });
});
