// Скриншоты адвент-пакета (телефон 390×844 и десктоп 1440×900): `npm run advent:shots -- <slug> [каталог]`.
// Нужен запущенный сервер на этом пакете, который принимает ?asOf= (демо-пакет `demo: true` или вне production),
// и Mailpit для письма со ссылкой входа (MAILPIT_URL, по умолчанию http://127.0.0.1:8025):
//   TENANT=<slug> npm run dev      (APP_URL по умолчанию http://127.0.0.1:3000)
// Скрипт сам ведёт участников через API с верными ответами из пакета (время двигает asOf), открывает страницу и снимает:
// отсчёт до старта, день 1, день с открытым листом на задании, удачу после раскрытия, подарок дня с QR и финал.
// Результат — WebP не тяжелее ~300 КБ в каталоге (по умолчанию shots/<slug>).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { adventPackSchema, TENANT_SLUG_PATTERN } from "../src/config/pack";
import { correctPayload } from "../src/domain/solve";
import { asOfForDay } from "../src/tools/advent-asof";
import { packs } from "../tenants/index";

const [slug, outArg] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!slug || !TENANT_SLUG_PATTERN.test(slug)) {
  console.error("Использование: npm run advent:shots -- <slug> [каталог]");
  process.exit(2);
}
const raw = (packs as Array<{ tenant?: string }>).find((item) => item.tenant === slug);
if (!raw || (raw as { experience?: string }).experience !== "advent") {
  console.error(`Адвент-пакет «${slug}» не найден в tenants/index.ts`);
  process.exit(2);
}
const { advent } = adventPackSchema.parse(raw);
const { copy, schedule } = advent;
const baseURL = process.env.APP_URL ?? "http://127.0.0.1:3000";
const mailpitUrl = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const outDir = path.resolve(outArg ?? path.join("shots", slug));
mkdirSync(outDir, { recursive: true });

const profiles = {
  mobile: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
  desktop: { viewport: { width: 1440, height: 900 } }
} as const;
type ProfileName = keyof typeof profiles;

const asOfDay = (n: number, hour = 12) => asOfForDay(schedule, n, hour);
const asOfFinale = new Date(new Date(schedule.finaleAt).getTime() + 3_600_000).toISOString();
const asOfBeforeStart = new Date(new Date(asOfDay(1, 0)).getTime() - 5 * 86_400_000).toISOString();

type Block = (typeof advent.days)[number]["blocks"][number];
const dayOf = (n: number) => advent.days.find((day) => day.n === n)!;
const firstDayWith = (type: Block["type"], after = 0) => advent.days.find((day) => day.n > after && day.blocks.some((block) => block.type === type))?.n;

async function launch(): Promise<Browser> {
  const executablePath = process.env.E2E_BROWSER_EXECUTABLE;
  const channel = process.env.E2E_BROWSER_CHANNEL;
  return chromium.launch({ ...(executablePath ? { executablePath } : channel ? { channel } : {}) });
}

async function call<T = unknown>(context: BrowserContext, method: "GET" | "POST", url: string, asOf: string, data?: unknown): Promise<T> {
  const response = await context.request.fetch(url, { method, data, headers: { origin: new URL(baseURL).origin, "x-advent-as-of": asOf } });
  if (!response.ok()) throw new Error(`${method} ${url}: ${response.status()} ${await response.text()}`);
  return (await response.json()) as T;
}

/** Пройти блоки дня n по API (верные ответы); `stopAt` — тип блока, на котором остановиться, не выполняя его. */
async function playDayApi(context: BrowserContext, n: number, asOf: string, stopAt?: Block["type"]) {
  await call(context, "POST", `/api/advent/days/${n}/open`, asOf);
  for (const [index, block] of dayOf(n).blocks.entries()) {
    if (block.type === stopAt) return;
    const payload = block.type === "task" ? { payload: correctPayload(block.task) } : block.type === "luck" ? { payload: { choice: 0 } } : {};
    await call(context, "POST", `/api/advent/days/${n}/blocks/${index}`, asOf, payload);
  }
}

/** Участник входит по ссылке из письма (Mailpit): награды с кодом выдаются только вошедшему. */
async function signIn(context: BrowserContext, asOf: string) {
  const email = `shots-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  await call(context, "POST", "/api/advent/identity/request", asOf, { email, consent: true, marketingConsent: false, reminderOptIn: false });
  let link = "";
  for (let attempt = 0; attempt < 40 && !link; attempt += 1) {
    const found = (await (await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as { messages: Array<{ ID: string }> };
    if (found.messages[0]) {
      const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${found.messages[0].ID}`)).json()) as { Text: string };
      link = message.Text.match(/https?:\/\/\S+\/api\/advent\/identity\/verify\?token=[\w-]+/)?.[0] ?? "";
    }
    if (!link) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!link) throw new Error("Письмо со ссылкой входа не пришло в Mailpit (нужен Mailpit и SMTP сервера)");
  const token = new URL(link).searchParams.get("token")!;
  const response = await context.request.post("/api/advent/identity/verify", {
    form: { token },
    headers: { origin: new URL(baseURL).origin, "x-advent-as-of": asOf },
    maxRedirects: 0
  });
  if (response.status() !== 303) throw new Error(`Вход по ссылке не удался: ${response.status()}`);
}

async function toWebp(converter: Page, png: Buffer): Promise<Buffer> {
  const base64 = await converter.evaluate(async (data) => {
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
    return canvas.toDataURL("image/webp", 0.86).split(",")[1];
  }, png.toString("base64"));
  return Buffer.from(base64, "base64");
}

const MAX_BYTES = 300 * 1024;

async function run(name: ProfileName) {
  const browser = await launch();
  const converter = await (await browser.newContext()).newPage();
  const fresh = async () => {
    const context = await browser.newContext({
      ...profiles[name],
      baseURL,
      extraHTTPHeaders: { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` }
    });
    return { context, page: await context.newPage() };
  };
  const shot = async (page: Page, step: string) => {
    await page.waitForTimeout(1800);
    const png = await page.screenshot();
    const file = path.join(outDir, `${name}-${step}.webp`);
    const webp = await toWebp(converter, png);
    writeFileSync(file, webp);
    console.log(`  ${path.relative(process.cwd(), file)} (${Math.round(webp.length / 1024)} КБ${webp.length > MAX_BYTES ? ", БОЛЬШЕ 300 КБ" : ""})`);
  };
  const open = async (page: Page, asOf: string) => {
    await page.goto(`/?asOf=${encodeURIComponent(asOf)}`);
    await page.waitForSelector(".adv-doors");
  };
  const door = (page: Page, n: number) => page.locator(`[data-door="${n}"]`);
  console.log(`\n${name}:`);
  try {
    // 01. Отсчёт до старта.
    {
      const { context, page } = await fresh();
      await page.goto(`/?asOf=${encodeURIComponent(asOfBeforeStart)}`);
      await page.waitForSelector(".adv-countdown");
      await shot(page, "01-upcoming");
      await context.close();
    }
    // 02. День 1: календарь в первый день.
    {
      const { context, page } = await fresh();
      await open(page, asOfDay(1));
      await shot(page, "02-day1");
      await context.close();
    }
    // 03. Лист дня на задании: день с заданием после нескольких пройденных, участник вошёл по ссылке.
    const taskDay = firstDayWith("task", 3) ?? firstDayWith("task")!;
    {
      const { context, page } = await fresh();
      await call(context, "POST", "/api/advent/participants", asOfDay(1));
      await signIn(context, asOfDay(1));
      for (let n = 1; n < taskDay; n += 1) await playDayApi(context, n, asOfDay(n));
      await call(context, "POST", `/api/advent/days/${taskDay}/open`, asOfDay(taskDay));
      const storyIndex = dayOf(taskDay).blocks.findIndex((block) => block.type === "story");
      if (storyIndex >= 0) await call(context, "POST", `/api/advent/days/${taskDay}/blocks/${storyIndex}`, asOfDay(taskDay), {});
      await open(page, asOfDay(taskDay));
      await shot(page, "03-calendar-streak");
      await door(page, taskDay).click();
      await page.getByRole("dialog").waitFor();
      await shot(page, "04-day-task");
      await context.close();
    }
    // 05. Удача после раскрытия.
    const luckDay = firstDayWith("luck");
    if (luckDay) {
      const { context, page } = await fresh();
      await call(context, "POST", "/api/advent/participants", asOfDay(1));
      await signIn(context, asOfDay(luckDay));
      await playDayApi(context, luckDay, asOfDay(luckDay), "luck");
      await open(page, asOfDay(luckDay));
      await door(page, luckDay).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: new RegExp(`^${copy.luckBoxLabel.replace("{i}", "2")}`) }).click();
      await dialog.getByText(copy.luckWon).waitFor();
      await shot(page, "05-luck-revealed");
      await context.close();
    }
    // 06. Подарок дня: код и QR для кассы.
    const promoDay = firstDayWith("promo");
    if (promoDay) {
      const { context, page } = await fresh();
      await call(context, "POST", "/api/advent/participants", asOfDay(1));
      await signIn(context, asOfDay(promoDay));
      await playDayApi(context, promoDay, asOfDay(promoDay), "promo");
      await open(page, asOfDay(promoDay));
      await door(page, promoDay).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: copy.promoOpen }).click();
      await dialog.getByTestId("promo-code").waitFor();
      await shot(page, "06-promo");
      await context.close();
    }
    // 07. Финал: почти все двери открыты.
    {
      const { context, page } = await fresh();
      await call(context, "POST", "/api/advent/participants", asOfDay(1));
      await signIn(context, asOfDay(1));
      const reached = Math.max(1, schedule.days - 2);
      for (let n = 1; n <= reached; n += 1) await playDayApi(context, n, asOfDay(n));
      await page.goto(`/?asOf=${encodeURIComponent(asOfFinale)}`);
      await page.waitForSelector(".adv-finale");
      await shot(page, "07-finale");
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

for (const name of Object.keys(profiles) as ProfileName[]) await run(name);
console.log(`\nГотово: ${outDir}`);
