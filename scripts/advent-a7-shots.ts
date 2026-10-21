// Скриншоты A7 (панель метрик, отчёт клиенту на экране и в печати A4, командный зачёт): `npm run advent:a7-shots -- <slug> [каталог]`.
// Нужен запущенный сервер на этом пакете (TENANT=<slug> npm run dev), демо-данные (`npm run advent:seed-demo -- <slug> --wipe`) и логин
// оператора ADMIN_USERNAME/ADMIN_PASSWORD (как у сервера). Время «после финала» задаёт ?asOf=. Результат — WebP не тяжелее 300 КБ.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, devices, type Browser, type Page } from "@playwright/test";

import { adventPackSchema, TENANT_SLUG_PATTERN } from "../src/config/pack";
import { asOfForDay } from "../src/tools/advent-asof";
import { loadPacks, packSlug } from "./lib/packs";

const [slug, outArg] = process.argv.slice(2);
if (!slug || !TENANT_SLUG_PATTERN.test(slug)) {
  console.error("Использование: npm run advent:a7-shots -- <slug> [каталог]");
  process.exit(2);
}
const raw = (await loadPacks()).find((item) => packSlug(item) === slug);
if (!raw || (raw as { experience?: string }).experience !== "advent") {
  console.error(`Адвент-пакет «${slug}» не найден в tenants/index.ts`);
  process.exit(2);
}
const { advent } = adventPackSchema.parse(raw);
const baseURL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const outDir = outArg ?? path.join("docs", "screens", "advent-a7");
mkdirSync(outDir, { recursive: true });
const credentials = { username: process.env.ADMIN_USERNAME ?? "operator", password: process.env.ADMIN_PASSWORD ?? "local-password-at-least-16" };
const asOfFinale = new Date(new Date(advent.schedule.finaleAt).getTime() + 3_600_000).toISOString();
const MAX_BYTES = 300 * 1024;

async function toWebp(converter: Page, png: Buffer): Promise<Buffer> {
  // Качество снижается, пока снимок не уложится в предел.
  for (const quality of [0.86, 0.75, 0.65, 0.55, 0.45]) {
    const base64 = await converter.evaluate(
      async ({ data, q }) => {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("картинка не загрузилась"));
          image.src = `data:image/png;base64,${data}`;
        });
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        return canvas.toDataURL("image/webp", q).split(",")[1];
      },
      { data: png.toString("base64"), q: quality }
    );
    const webp = Buffer.from(base64, "base64");
    if (webp.length <= MAX_BYTES || quality === 0.45) return webp;
  }
  throw new Error("недостижимо");
}

async function launch(): Promise<Browser> {
  const executablePath = process.env.E2E_BROWSER_EXECUTABLE;
  const channel = process.env.E2E_BROWSER_CHANNEL;
  return chromium.launch({ ...(executablePath ? { executablePath } : channel ? { channel } : {}) });
}

const browser = await launch();
// Индикатор dev-сервера Next не должен попадать в кадр.
const hideDevBadge = async (page: Page) => {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
};
try {
  const converter = await (await browser.newContext()).newPage();
  const save = async (name: string, png: Buffer) => {
    const webp = await toWebp(converter, png);
    const file = path.join(outDir, `${slug}-${name}.webp`);
    writeFileSync(file, webp);
    console.log(`  ${file} (${Math.round(webp.length / 1024)} КБ${webp.length > MAX_BYTES ? ", БОЛЬШЕ 300 КБ" : ""})`);
  };

  // Панель оператора, рабочий стол: верх (плитки, выводы, кривая) и нижние блоки.
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL, httpCredentials: credentials, reducedMotion: "reduce" });
  const admin = await desktop.newPage();
  await admin.goto(`/admin?asOf=${encodeURIComponent(asOfFinale)}`);
  await admin.getByRole("heading", { level: 2, name: "Кривая по дням" }).waitFor();
  await hideDevBadge(admin);
  await save("dashboard-top", await admin.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: 1280, height: 1250 } }));
  const cohorts = admin.locator("section", { has: admin.getByRole("heading", { name: /^Когорты/ }) });
  const rewards = admin.locator("section", { has: admin.getByRole("heading", { name: "Воронка наград" }) });
  await save("dashboard-cohorts", await cohorts.screenshot());
  await save("dashboard-rewards", await rewards.screenshot());
  if (advent.audience.leaderboard === "teams") {
    await save("dashboard-teams", await admin.locator("section", { has: admin.getByRole("heading", { name: "Команды" }) }).screenshot());
  }

  // Панель на телефоне.
  const phone = await browser.newContext({ ...devices["Pixel 7"], baseURL, httpCredentials: credentials });
  const phoneAdmin = await phone.newPage();
  await phoneAdmin.goto(`/admin?asOf=${encodeURIComponent(asOfFinale)}`);
  await phoneAdmin.getByRole("heading", { level: 2, name: "Кривая по дням" }).waitFor();
  await hideDevBadge(phoneAdmin);
  await save("dashboard-phone", await phoneAdmin.screenshot({ clip: { x: 0, y: 0, width: 412, height: 1500 }, fullPage: true }));

  // Отчёт клиенту: экран и печать A4 (ширина 794 px = 210 мм при 96 dpi, поля 14 мм).
  const report = await desktop.newPage();
  await report.goto(`/admin/report?asOf=${encodeURIComponent(asOfFinale)}`);
  await report.getByRole("heading", { level: 2, name: "Как мы считаем" }).waitFor();
  await hideDevBadge(report);
  await save("report-screen", await report.screenshot({ fullPage: true }));
  const paper = await browser.newContext({ viewport: { width: 794, height: 1123 }, baseURL, httpCredentials: credentials });
  const print = await paper.newPage();
  await print.goto(`/admin/report?asOf=${encodeURIComponent(asOfFinale)}`);
  await print.emulateMedia({ media: "print" });
  await print.getByRole("heading", { level: 2, name: "Как мы считаем" }).waitFor();
  await hideDevBadge(print);
  await save("report-print", await print.screenshot({ fullPage: true }));

  // Командный зачёт глазами участника (телефон): лист серии с выбором команды и финал.
  if (advent.audience.leaderboard === "teams") {
    const open = async (asOf: string) => {
      const context = await browser.newContext({ ...devices["Pixel 7"], baseURL, extraHTTPHeaders: { "x-forwarded-for": `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` } });
      const page = await context.newPage();
      await page.goto(`/?asOf=${encodeURIComponent(asOf)}`);
      await page.getByRole("heading", { level: 1, name: advent.title }).waitFor();
      return page;
    };
    const player = await open(asOfForDay(advent.schedule, 3, 12));
    if (advent.presentation === "storefront") await player.locator(".adv-garland-btn").click();
    const board = player.getByRole("region", { name: advent.copy.teamTitle });
    await board.waitFor();
    await hideDevBadge(player);
    await board.getByRole("radio", { name: advent.audience.teams![1].title }).click();
    await player.getByText(advent.copy.teamMine).waitFor();
    await board.scrollIntoViewIfNeeded();
    await player.waitForTimeout(600);
    await save("team-board", await player.screenshot());
    const final = await open(asOfFinale);
    await final.getByRole("region", { name: advent.copy.teamTitle }).waitFor();
    await hideDevBadge(final);
    await final.getByRole("region", { name: advent.copy.teamTitle }).scrollIntoViewIfNeeded();
    await final.waitForTimeout(600);
    await save("team-board-finale", await final.screenshot());
  }
} finally {
  await browser.close();
}
