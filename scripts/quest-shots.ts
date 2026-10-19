// Скриншоты ключевых состояний квеста: `npx tsx scripts/quest-shots.ts <каталог> [mobile|desktop]`.
// Нужен запущенный сервер с QUIZ_FORCE_OPEN=true; адрес — APP_URL (по умолчанию http://127.0.0.1:3000).
// Браузер: E2E_BROWSER_EXECUTABLE — путь к Chromium, иначе встроенный Chromium Playwright.
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium, devices, expect, type Page } from "@playwright/test";

import { campaign } from "../tenants/demo-office/campaign";
import { fillTask, expectReveal, outcomeFor, rooms } from "../tests/e2e/support/game";
import {
  answerQuestRush, completeQuest as _unused, expectPhase, openRoomViaList, playQuestRoom, questRoomOrder, roomListButton, startQuest, startQuestRush
} from "../tests/e2e/support/quest";

void _unused;
const baseURL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const outDir = process.argv[2];
if (!outDir) {
  console.error("Укажите каталог для скриншотов: npx tsx scripts/quest-shots.ts <каталог> [mobile|desktop]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const profiles = {
  mobile: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
  desktop: { viewport: { width: 1440, height: 900 } }
} as const;

async function shot(page: Page, name: string, wait = 900) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

async function run(profileName: keyof typeof profiles) {
  const executablePath = process.env.E2E_BROWSER_EXECUTABLE;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ ...profiles[profileName], baseURL, extraHTTPHeaders: { "x-forwarded-for": `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` } });
  const page = await context.newPage();
  const p = (name: string) => `${profileName}-${name}`;

  await page.goto("/");
  await expectPhase(page, "prologue");
  await shot(page, p("01-prologue-wide"), 1600);
  await page.getByRole("button", { name: "Дальше" }).click();
  await shot(page, p("02-prologue-robot-flies"), 900);
  await page.getByRole("button", { name: "Дальше" }).waitFor();
  await shot(page, p("03-prologue-hero"), 900);
  for (let step = 1; step < campaign.prologue.lines.length; step += 1) await page.getByRole("button", { name: "Дальше" }).click();
  await shot(page, p("04-prologue-mfa"), 500);
  await page.getByRole("switch").click();
  await page.getByRole("button", { name: "Войти в офис" }).click();
  await expectPhase(page, "explore");
  await shot(page, p("05-explore-start"), 2500);

  await roomListButton(page).click();
  await shot(page, p("06-room-list"), 400);
  const mail = rooms.find((room) => room.id === "mail")!;
  await page.getByRole("dialog", { name: "Список комнат" }).getByRole("button", { name: /Почтовая/ }).click();
  await shot(page, p("07-near-hero"), 1200);
  await page.getByRole("button", { name: /^Помочь:/ }).click();
  await page.getByRole("dialog", { name: /Заявка в комнате/ }).waitFor();
  await shot(page, p("08-task-phish"), 1500);
  await fillTask(page, mail.tasks[0], "correct");
  await expectReveal(page, outcomeFor(mail.tasks[0], "correct"));
  await shot(page, p("09-reveal"), 900);
  await page.getByRole("button", { name: "Следующая заявка" }).click();
  await expect(page.getByText("заявка 2 из 3")).toBeVisible();
  await fillTask(page, mail.tasks[1], "wrong");
  await shot(page, p("10-miss-fault"), 500);
  await page.getByRole("button", { name: "Следующая заявка" }).click();
  await expect(page.getByText("заявка 3 из 3")).toBeVisible();
  await shot(page, p("11-task-build"), 1000);
  await fillTask(page, mail.tasks[2], "correct");
  await page.getByRole("button", { name: "Включить свет в комнате" }).click();
  await shot(page, p("12-room-summary"), 900);
  await page.getByRole("button", { name: "К ёлке: повесить игрушку" }).click();
  await shot(page, p("13-celebrate-start"), 350);
  await shot(page, p("14-celebrate-wide"), 900);
  await shot(page, p("15-celebrate-toy-flies"), 700);
  await expectPhase(page, "explore", 30_000);
  await shot(page, p("16-after-celebrate"), 1200);

  for (const room of questRoomOrder.filter((candidate) => candidate.id !== "mail").slice(0, 3)) await playQuestRoom(page, room);
  await shot(page, p("17-four-rooms-lit"), 1200);
  const last = questRoomOrder.find((room) => room.id === "messenger")!;
  await playQuestRoom(page, last, ["correct", "correct", "correct"], true);
  await shot(page, p("18-rush-intro"), 2200);
  await startQuestRush(page);
  await shot(page, p("19-rush"), 1200);
  await answerQuestRush(page, true);
  await shot(page, p("20-rush-answered"), 700);
  await answerQuestRush(page, false);
  await shot(page, p("21-rush-miss"), 300);
  // Съёмка съедает часть 30 секунд: если время вышло раньше пула, рывок просто заканчивается.
  for (let index = 2; index < campaign.rush.pool.length; index += 1) {
    try {
      await answerQuestRush(page, true);
    } catch {
      break;
    }
  }
  await expectPhase(page, "final", 40_000);
  await shot(page, p("22-final"), 2800);
  await page.getByRole("button", { name: "Забрать подарок" }).click();
  await shot(page, p("23-claim"), 900);
  await page.getByRole("button", { name: "← К результату" }).click();
  await page.getByRole("button", { name: "Поделиться результатом" }).click();
  await shot(page, p("24-share"), 900);
  await browser.close();
  void openRoomViaList;
  void startQuest;
}

const which = process.argv[3] as keyof typeof profiles | undefined;
for (const name of which ? [which] : (["mobile", "desktop"] as const)) await run(name);
console.log(`Готово: ${outDir}`);
