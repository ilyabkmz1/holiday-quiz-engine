// Скриншоты всех состояний игры пакета (mobile + desktop): `npm run quiz:shots -- <slug> [каталог]`.
// Нужен запущенный сервер, который показывает этот пакет и открыт вне окна кампании, например:
//   TENANT=<slug> QUIZ_FORCE_OPEN=true npm run dev      (APP_URL по умолчанию http://127.0.0.1:3000)
// Скрипт сам создаёт сессию через API, доводит её до нужного состояния верными ответами (ответы берёт из пакета)
// и открывает страницу: клиент восстанавливает экран по данным сервера. Результат — PNG в каталоге
// (по умолчанию shots/<slug>), по которым агент проверяет вёрстку.
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { correctPayload } from "../src/domain/solve";
import type { Task } from "../src/config/schema";
import { TENANT_SLUG_PATTERN, packSchema } from "../src/config/pack";
import { packs } from "../tenants/index";

const [slug, outArg] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!slug) {
  console.error("Использование: npm run quiz:shots -- <slug> [каталог]");
  process.exit(2);
}
if (!TENANT_SLUG_PATTERN.test(slug)) {
  console.error(`slug «${slug}» не годится: латиница в нижнем регистре, цифры и дефис, 2–41 символ (например, demo-coffee).`);
  process.exit(2);
}
const raw = (packs as Array<{ tenant?: string }>).find((item) => item.tenant === slug);
if (!raw) {
  console.error(`Пакет «${slug}» не найден в tenants/index.ts`);
  process.exit(2);
}
const { campaign } = packSchema.parse(raw);
const baseURL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const outDir = path.resolve(outArg ?? path.join("shots", slug));
mkdirSync(outDir, { recursive: true });

const SESSION_KEY = "hqe-holiday-quiz-session";
const profiles = {
  mobile: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
  desktop: { viewport: { width: 1440, height: 900 } }
} as const;

async function launch(): Promise<Browser> {
  const executablePath = process.env.E2E_BROWSER_EXECUTABLE;
  const channel = process.env.E2E_BROWSER_CHANNEL;
  return chromium.launch({ ...(executablePath ? { executablePath } : channel ? { channel } : {}) });
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(900);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log(`  ${path.relative(process.cwd(), file)}`);
}

async function api(context: BrowserContext, method: "GET" | "POST", url: string, data?: unknown) {
  const response = await context.request.fetch(url, { method, data, headers: { origin: new URL(baseURL).origin } });
  if (!response.ok()) throw new Error(`${method} ${url}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function openWith(page: Page, sessionId: string | null) {
  await page.goto("/");
  await page.evaluate(([key, id]) => {
    if (id) window.localStorage.setItem(key as string, id as string);
    else window.localStorage.removeItem(key as string);
  }, [SESSION_KEY, sessionId]);
  await page.reload();
}

async function run(name: keyof typeof profiles) {
  const browser = await launch();
  const context = await browser.newContext({
    ...profiles[name],
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` }
  });
  const page = await context.newPage();
  const tag = (step: string) => `${name}-${step}`;
  console.log(`\n${name}:`);
  try {
    await openWith(page, null);
    await shot(page, tag("01-landing"), true);

    const created = (await api(context, "POST", "/api/sessions")) as { sessionId: string };
    const id = created.sessionId;
    await openWith(page, id);
    await shot(page, tag("02-prologue-or-map"));

    const [first, ...rest] = campaign.rooms;
    await api(context, "POST", `/api/sessions/${id}/rooms/${first.id}/enter`);
    await api(context, "GET", `/api/sessions/${id}/rooms/${first.id}/task`);
    await openWith(page, id);
    await shot(page, tag("03-first-task"));

    for (const task of first.tasks as Task[]) {
      await api(context, "GET", `/api/sessions/${id}/rooms/${first.id}/task`);
      await api(context, "POST", `/api/sessions/${id}/answers`, { taskId: task.id, payload: correctPayload(task) });
    }
    await openWith(page, id);
    await shot(page, tag("04-after-first-zone"));

    for (const room of rest) {
      await api(context, "POST", `/api/sessions/${id}/rooms/${room.id}/enter`);
      for (const task of room.tasks as Task[]) {
        await api(context, "GET", `/api/sessions/${id}/rooms/${room.id}/task`);
        await api(context, "POST", `/api/sessions/${id}/answers`, { taskId: task.id, payload: correctPayload(task) });
      }
    }
    await openWith(page, id);
    await shot(page, tag("05-all-zones-done"));

    await api(context, "POST", `/api/sessions/${id}/rush/start`);
    await openWith(page, id);
    await shot(page, tag("06-rush"));

    await api(context, "POST", `/api/sessions/${id}/rush/finish`);
    await api(context, "POST", `/api/sessions/${id}/complete`);
    await openWith(page, id);
    await shot(page, tag("07-final"), true);

    await page.goto(`/share/${id}`);
    await shot(page, tag("08-share-page"));
    await page.goto("/privacy");
    await shot(page, tag("09-privacy"), true);
  } finally {
    await browser.close();
  }
}

for (const profile of Object.keys(profiles) as Array<keyof typeof profiles>) await run(profile);
console.log(`\nГотово: ${outDir}`);
