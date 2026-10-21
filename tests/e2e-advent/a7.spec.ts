import { execFileSync } from "node:child_process";

import { localEnv } from "../e2e/support/env";
import { advent, asOfDay, asOfFinale, copy, expect, gotoAt, storefront, tenantSlug, test } from "./support/advent";

const auth = `Basic ${Buffer.from(`${localEnv.ADMIN_USERNAME}:${localEnv.ADMIN_PASSWORD}`).toString("base64")}`;
const credentials = { username: localEnv.ADMIN_USERNAME, password: localEnv.ADMIN_PASSWORD };
const teams = advent.audience.leaderboard === "teams";

test.describe("метрики и отчёт клиенту (A7)", () => {
  // Демо-данные добавляются к кампании (--append, свой номер зерна), не стирая участников параллельных тестов; письма им не уходят.
  test.describe.configure({ mode: "serial" });
  const seed = 1_000_000 + Math.floor(Math.random() * 8_000_000);

  test.beforeAll(() => {
    execFileSync("npx", ["tsx", "scripts/advent-seed-demo.ts", tenantSlug, "--participants", "40", "--seed", String(seed), "--append", "--through", advent.schedule.finaleAt], {
      encoding: "utf8",
      env: { ...process.env, ...localEnv, TENANT: tenantSlug, NODE_ENV: "development" },
      timeout: 240_000
    });
  });

  test("seed-demo → /admin: плитки, графики с таблицами, воронки, когорты; email на странице нет", async ({ browser }) => {
    const context = await browser.newContext({ httpCredentials: credentials });
    const page = await context.newPage();
    try {
      const response = await page.goto(`/admin?asOf=${encodeURIComponent(asOfFinale)}`);
      expect(response?.status()).toBe(200);
      for (const name of ["Итоги", "Выводы", "Кривая по дням", "Воронка регистрации", "Когорты: возврат по дню первого визита", "Воронка наград"]) {
        await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
      }
      const participants = page.locator(".kpi", { hasText: "Участники" });
      const count = Number((await participants.locator("dd").first().textContent())!.replace(/\D.*$/s, "").replace(/\s/g, ""));
      expect(count).toBeGreaterThanOrEqual(40);
      // График: описание для скринридера и таблица с теми же числами.
      await expect(page.getByRole("img", { name: /Столбчатая диаграмма по дням кампании/ })).toBeVisible();
      await page.getByText("Таблица к графику").first().click();
      await expect(page.locator("details[open] table tbody tr")).toHaveCount(advent.schedule.days);
      // Вся страница умещается в экран: прокрутка допустима только внутри таблиц.
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      expect(await page.locator("body").innerText()).not.toMatch(/\S+@\S+/);
      if (teams) await expect(page.getByRole("heading", { level: 2, name: "Команды" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("/admin/report: отчёт в бренде клиента, печать A4 без панели управления, PDF", async ({ browser }) => {
    const context = await browser.newContext({ httpCredentials: credentials });
    const page = await context.newPage();
    try {
      await page.goto(`/admin?asOf=${encodeURIComponent(asOfFinale)}`);
      await page.getByRole("link", { name: "Отчёт клиенту (PDF)" }).click();
      await expect(page).toHaveURL(/\/admin\/report\?asOf=/);
      await expect(page.getByRole("heading", { level: 1, name: advent.title })).toBeVisible();
      for (const name of ["Ключевые цифры", "Выводы", "Кривая по дням", "Воронки", "Возврат участников", "Как мы считаем"]) {
        await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
      }
      await expect(page.getByRole("button", { name: "Сохранить в PDF" })).toBeVisible();
      await expect(page.getByText(advent.brand.name).first()).toBeVisible();
      expect(await page.locator("body").innerText()).not.toMatch(/\S+@\S+/);

      await page.emulateMedia({ media: "print" });
      await expect(page.getByRole("button", { name: "Сохранить в PDF" })).toBeHidden();
      await expect(page.getByRole("link", { name: "← В панель" })).toBeHidden();
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      expect(pages).toBeGreaterThanOrEqual(1);
      expect(pages).toBeLessThanOrEqual(6);
    } finally {
      await context.close();
    }
  });

  test("CSV: по дням, награды, когорты — только оператору, без email, с заголовками", async ({ request }) => {
    for (const name of ["days.csv", "rewards.csv", "cohorts.csv"]) {
      const path = `/api/admin/advent/report/${name}?asOf=${encodeURIComponent(asOfFinale)}`;
      expect((await request.get(path)).status(), `${name} без пароля`).toBe(401);
      const response = await request.get(path, { headers: { authorization: auth } });
      expect(response.status(), name).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/csv");
      expect(response.headers()["content-disposition"]).toContain(`${tenantSlug}-advent-${name}`);
      const body = await response.text();
      expect(body.startsWith("﻿")).toBe(true);
      expect(body).not.toMatch(/\S+@\S+/);
      expect(body.split("\r\n").length).toBeGreaterThan(2);
    }
  });

  test("командный зачёт: выбор команды и публичный рейтинг без имён", async ({ page }) => {
    test.skip(!teams, "в пакете нет рейтинга по командам");
    await gotoAt(page, asOfDay(2));
    if (storefront) await page.getByRole("button", { name: /Подробнее о серии/ }).click();
    const board = page.getByRole("region", { name: copy.teamTitle });
    await expect(board).toBeVisible();
    const first = advent.audience.teams![0];
    await board.getByRole("radio", { name: first.title }).click();
    await expect(board.getByRole("radio", { name: first.title })).toBeChecked();
    await expect(board.getByRole("list", { name: copy.teamTableLabel })).toBeVisible();
    // Рейтинг: названия команд и цифры, никаких адресов и идентификаторов.
    const text = (await board.textContent())!;
    expect(text).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/);
    // Выбор переживает перезагрузку.
    await gotoAt(page, asOfDay(2));
    if (storefront) await page.getByRole("button", { name: /Подробнее о серии/ }).click();
    await expect(page.getByRole("region", { name: copy.teamTitle }).getByRole("radio", { name: first.title })).toBeChecked();
  });
});
