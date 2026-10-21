// Скриншоты мини-приложения в имитации Telegram: `npm run telegram:shots -- <каталог>` (по умолчанию docs/screens/telegram-miniapp).
// Нужен запущенный сервер на демо-пакете с Telegram (`TENANT=demo-coffee-advent`) и тестовыми TELEGRAM_BOT_TOKEN/PLATFORM_ID_SECRET
// из playwright.advent.config.ts; адрес — APP_URL (по умолчанию http://127.0.0.1:3000), оператор — ADMIN_USERNAME/ADMIN_PASSWORD.
// Окно 390×720 с отступами safe area, как у телефона; рамки Telegram нет. Картинки — webp до 300 КБ.
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

import { chromium, devices, type Page } from "@playwright/test";
import sharp from "sharp";

import { adventPackSchema } from "../src/config/pack";
import { asOfForDay } from "../src/tools/advent-asof";
import { packs } from "../tenants/index";
import { e2eInitData, installFakeTelegram } from "../tests/e2e-advent/support/telegram";

const baseURL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const outDir = process.argv[2] ?? "docs/screens/telegram-miniapp";
mkdirSync(outDir, { recursive: true });

const tenant = process.env.E2E_TENANT ?? "demo-coffee-advent";
const raw = (packs as Array<{ tenant?: string }>).find((item) => item.tenant === tenant);
if (!raw) throw new Error(`Пакета ${tenant} нет в tenants/index.ts`);
const pack = adventPackSchema.parse(raw);
const { advent } = pack;
const { copy } = advent;
const day = advent.days.find((candidate) => candidate.blocks.some((block) => block.type === "promo")) ?? advent.days[0];
const asOf = asOfForDay(advent.schedule, day.n, 12);

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(900);
  const png = await page.screenshot({ fullPage });
  const file = path.join(outDir, `${name}.webp`);
  for (const quality of [82, 70, 58, 46]) {
    await sharp(png).webp({ quality }).toFile(file);
    if (statSync(file).size <= 300 * 1024) break;
  }
  console.log(`${file} ${Math.round(statSync(file).size / 1024)} КБ`);
}

const browser = await chromium.launch({
  ...(process.env.E2E_BROWSER_EXECUTABLE ? { executablePath: process.env.E2E_BROWSER_EXECUTABLE } : {})
});
try {
  const context = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 720 }, baseURL, reducedMotion: "reduce" });
  const page = await context.newPage();
  // tsx оборачивает функции в `__name`, а в страницу они уходят как есть (`addInitScript`): без заглушки скрипт падает.
  await page.addInitScript("window.__name = window.__name || ((fn) => fn);");
  await installFakeTelegram(page, e2eInitData(900_000_000 + Math.floor(Math.random() * 99_000_000)));
  await page.goto(`/?asOf=${encodeURIComponent(asOf)}`);

  await page.getByRole("heading", { level: 1, name: copy.telegramConsentTitle }).waitFor();
  await shot(page, "01-consent");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: copy.telegramConsentStart }).click();
  await page.locator(`[data-door="${day.n}"]`).waitFor();
  await shot(page, "02-facade");

  await page.locator(`[data-door="${day.n}"]`).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const { playDay } = await import("../tests/e2e-advent/support/advent");
  // playDay кликает окно сам: закрываем лист и проходим день целиком, затем показываем награду.
  await page.evaluate(() => (window as unknown as { __tg: { backClick: () => void } }).__tg.backClick());
  await playDay(page, day.n);
  await page.getByTestId("promo-code").first().scrollIntoViewIfNeeded();
  await shot(page, "03-day-promo");

  const admin = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    baseURL,
    httpCredentials: { username: process.env.ADMIN_USERNAME ?? "operator", password: process.env.ADMIN_PASSWORD ?? "local-password-at-least-16" }
  });
  const adminPage = await admin.newPage();
  await adminPage.goto("/admin");
  await adminPage.locator("#telegram-title").scrollIntoViewIfNeeded();
  await adminPage.locator("section[aria-labelledby=telegram-title]").screenshot({ path: path.join(outDir, "04-admin-links.png") });
  await sharp(path.join(outDir, "04-admin-links.png")).webp({ quality: 80 }).toFile(path.join(outDir, "04-admin-links.webp"));
  console.log(`${path.join(outDir, "04-admin-links.webp")} ${Math.round(statSync(path.join(outDir, "04-admin-links.webp")).size / 1024)} КБ`);
  await import("node:fs").then((fs) => fs.rmSync(path.join(outDir, "04-admin-links.png")));
} finally {
  await browser.close();
}
