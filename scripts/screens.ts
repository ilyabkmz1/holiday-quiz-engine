// Скриншоты ключевых экранов для визуальной сверки с макетами: `npx tsx scripts/screens.ts <каталог>`.
// Каталог обязателен (он создаётся, если его нет). Нужен запущенный dev-сервер с QUIZ_FORCE_OPEN=true;
// адрес берётся из APP_URL (по умолчанию http://127.0.0.1:3000).
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium, devices, type Page } from "@playwright/test";

import { campaign } from "../tenants/demo-office/campaign";
import {
  answerRushItem,
  enterRoom,
  fillTask,
  mapHeading,
  nextAfterReveal,
  playRoom,
  roomSpot,
  rooms,
  startButton
} from "../tests/e2e/support/game";

const baseURL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const outDir = process.argv[2];
if (!outDir) {
  console.error("Укажите каталог для скриншотов: npx tsx scripts/screens.ts <каталог>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const profiles = {
  mobile: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
  desktop: { viewport: { width: 1440, height: 900 } }
} as const;

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage });
}

const room = (id: string) => rooms.find((candidate) => candidate.id === id)!;

async function run(profileName: keyof typeof profiles) {
  const browser = await chromium.launch(process.env.E2E_BROWSER_CHANNEL === undefined ? {} : process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {});
  const context = await browser.newContext({ ...profiles[profileName], baseURL, extraHTTPHeaders: { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` } });
  const page = await context.newPage();
  const p = (name: string) => `${profileName}-${name}`;

  await page.goto("/");
  await startButton(page).waitFor();
  await shot(page, p("01-landing"), true);
  await startButton(page).click();
  await shot(page, p("02-prologue-start"));
  for (let step = 1; step < campaign.prologue.lines.length; step += 1) await page.getByRole("button", { name: "Дальше" }).click();
  await shot(page, p("03-prologue-mfa"), true);
  await page.getByRole("switch").click();
  await page.getByRole("button", { name: "К карте офиса" }).click();
  await mapHeading(page).waitFor();
  await shot(page, p("04-map-empty"), true);

  // Почта: phish, pick (верно/сбой), build
  await enterRoom(page, room("mail"));
  await shot(page, p("05-phish"), true);
  await fillTask(page, room("mail").tasks[0], "correct");
  await shot(page, p("06-reveal-phish"), true);
  await nextAfterReveal(page, false);
  await shot(page, p("07-pick"), true);
  await fillTask(page, room("mail").tasks[1], "wrong");
  await shot(page, p("08-reveal-miss"), true);
  await nextAfterReveal(page, false);
  await shot(page, p("09-build-empty"), true);
  const build = room("mail").tasks[2];
  if (build.type === "build") {
    await page.getByRole("group", { name: "Карточки сценария" }).getByRole("button").nth(0).click();
    await page.getByRole("group", { name: "Карточки сценария" }).getByRole("button").nth(1).click();
    await shot(page, p("10-build-partial"), true);
    await page.getByRole("group", { name: "Карточки сценария" }).getByRole("button").nth(0).click();
    await page.getByRole("group", { name: "Карточки сценария" }).getByRole("button").nth(1).click();
  }
  await fillTask(page, build, "correct");
  await shot(page, p("11-reveal-build"), true);
  await nextAfterReveal(page, true);
  await shot(page, p("12-room-result"), true);
  await page.getByRole("button", { name: "Вернуться в офис" }).click();
  await shot(page, p("13-map-one"), true);

  // Файлы: access; Проекты: order
  await enterRoom(page, room("files"));
  await shot(page, p("14-access"), true);
  await fillTask(page, room("files").tasks[0], "correct");
  await nextAfterReveal(page, false);
  await fillTask(page, room("files").tasks[1], "correct");
  await nextAfterReveal(page, false);
  await fillTask(page, room("files").tasks[2], "correct");
  await nextAfterReveal(page, true);
  await page.getByRole("button", { name: "Вернуться в офис" }).click();
  await mapHeading(page).waitFor();
  // access — задание 1 комнаты «files»? определим по типу
  for (const r of rooms) {
    if (r.id === "files") continue;
    const idx = r.tasks.findIndex((t) => t.type === "access" || t.type === "order");
    if (idx >= 0) {
      const target = r.tasks[idx];
      await enterRoom(page, r);
      for (let i = 0; i < idx; i += 1) {
        await fillTask(page, r.tasks[i], "correct");
        await nextAfterReveal(page, false);
      }
      await shot(page, p(`15-${target.type}-empty`), true);
      await fillTask(page, target, "partial");
      await shot(page, p(`16-reveal-${target.type}`), true);
      await nextAfterReveal(page, idx === r.tasks.length - 1);
      for (let i = idx + 1; i < r.tasks.length; i += 1) {
        await fillTask(page, r.tasks[i], "correct");
        await nextAfterReveal(page, i === r.tasks.length - 1);
      }
      await page.getByRole("button", { name: /^(Вернуться в офис|К карте: открыт финальный рывок)$/ }).click();
      await mapHeading(page).waitFor();
    }
  }
  // Остальные комнаты
  for (const r of rooms) {
    if (await roomSpot(page, r).count()) {
      const done = (await roomSpot(page, r).getAttribute("aria-label"))?.startsWith("Открыть");
      if (done) await playRoom(page, r);
    }
  }
  await shot(page, p("17-map-all"), true);
  await page.getByRole("button", { name: "Финал: рывок до полуночи" }).click();
  await shot(page, p("18-rush-intro"));
  await page.getByRole("button", { name: "Поехали!" }).click();
  await page.locator(".rush-prompt").waitFor();
  await answerRushItem(page, true);
  await page.waitForTimeout(150);
  await answerRushItem(page, false);
  await shot(page, p("19-rush"), true);
  for (let i = 0; i < campaign.rush.pool.length; i += 1) {
    if (await page.getByLabel("Результат").count()) break;
    const before = await page.locator(".rush-prompt").textContent().catch(() => null);
    if (!before || !campaign.rush.pool.some((item) => item.prompt === before.trim())) break;
    await answerRushItem(page, true);
    await page.waitForFunction((text) => document.querySelector(".rush-prompt")?.textContent !== text, before).catch(() => undefined);
  }
  await page.getByLabel("Результат").waitFor({ timeout: 20_000 });
  await shot(page, p("20-final"), true);
  await page.getByRole("button", { name: "Забрать подарок" }).click();
  await shot(page, p("21-claim"), true);
  await page.getByRole("button", { name: "← К результату" }).click();
  await page.getByRole("button", { name: "Поделиться результатом" }).click();
  await shot(page, p("22-share"), true);
  await page.goto("/verify?status=success");
  await shot(page, p("23-verify"), true);
  await browser.close();
}

(async () => {
  for (const name of Object.keys(profiles) as Array<keyof typeof profiles>) await run(name);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
