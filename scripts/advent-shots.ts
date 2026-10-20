// Скриншоты адвент-пакета (телефон 390×844 и десктоп 1440×900): `npm run advent:shots -- <slug> [каталог]`
// или `npm run quiz:shots -- <slug> --day 1..N [каталог]` (то же для адвента) — каждый день отдельно и один файл index.html для согласования.
// Нужен запущенный сервер на этом пакете, который принимает ?asOf= (демо-пакет `demo: true` или вне production),
// и Mailpit для письма со ссылкой входа (MAILPIT_URL, по умолчанию http://127.0.0.1:8025):
//   TENANT=<slug> npm run dev      (APP_URL по умолчанию http://127.0.0.1:3000)
// Скрипт сам ведёт участников через API с верными ответами из пакета (время двигает asOf), открывает страницу и снимает:
// отсчёт до старта, день 1, день с открытым листом на задании, удачу после раскрытия, подарок дня с QR и финал.
// Для «Витрины» (presentation: storefront) вместо календаря снимаются фасад в день 1, фасад в день 6 с пропущенным днём,
// экран дня с историей, задание «собери» (build или order), удача, подарок дня и финал; `--facade-only` — только фасад дня 6
// (для сравнения шаблонов на временной копии пакета с другим `facade.templateId`).
// Результат — WebP не тяжелее ~300 КБ в каталоге (по умолчанию shots/<slug>).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { adventPackSchema, TENANT_SLUG_PATTERN } from "../src/config/pack";
import { correctPayload } from "../src/domain/solve";
import { asOfForDay } from "../src/tools/advent-asof";
import { fillTask, finishSpeech, storefrontNames } from "../src/tools/advent-driver";
import { loadPacks, packSlug } from "./lib/packs";

const argv = process.argv.slice(2);
const dayFlag = argv.indexOf("--day");
const dayArg = dayFlag >= 0 ? argv[dayFlag + 1] : undefined;
const withDesktop = argv.includes("--desktop");
const facadeOnly = argv.includes("--facade-only");
const [slug, outArg] = argv.filter((arg, index) => !arg.startsWith("--") && argv[index - 1] !== "--day");
if (!slug || !TENANT_SLUG_PATTERN.test(slug)) {
  console.error("Использование: npm run advent:shots -- <slug> [каталог] [--day 1..N] [--desktop]");
  process.exit(2);
}
const raw = (await loadPacks()).find((item) => packSlug(item) === slug);
if (!raw || (raw as { experience?: string }).experience !== "advent") {
  console.error(`Адвент-пакет «${slug}» не найден в tenants/index.ts`);
  process.exit(2);
}
const { advent } = adventPackSchema.parse(raw);
const { copy, schedule } = advent;
const storefront = advent.presentation === "storefront";
/** Названия элементов «Витрины» для драйвера (листание реплик, обложки заданий); у календаря их нет. */
const names = storefront ? storefrontNames(copy) : undefined;
/** Дождаться главного экрана: фасад «Витрины» или сетка дверей календаря. */
const mainSelector = storefront ? ".adv-facade" : ".adv-doors";

/** `--day`: «5», «1..5» или «1..N» (до последнего дня). */
function parseDays(value: string): number[] | null {
  const match = /^(\d+)(?:\.\.(\d+|N))?$/.exec(value.trim());
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : match[2] === "N" ? schedule.days : Number(match[2]);
  if (from < 1 || to > schedule.days || from > to) return null;
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
const dayList = dayArg === undefined ? null : parseDays(dayArg);
if (dayArg !== undefined && dayList === null) {
  console.error(`--day: «${dayArg}» не годится; ожидается номер дня (5) или диапазон (1..5, 1..N) в пределах 1–${schedule.days}.`);
  process.exit(2);
}
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
    await page.waitForSelector(mainSelector);
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
    // 02. День 1: календарь (фасад) в первый день.
    {
      const { context, page } = await fresh();
      await open(page, asOfDay(1));
      await shot(page, storefront ? "02-day1-facade" : "02-day1");
      await context.close();
    }
    if (storefront) {
      // 03–04. День 6: первые дни пройдены, день 4 пропущен (иней), день 5 можно догнать; затем экран дня с историей.
      const today = Math.min(6, schedule.days - 1);
      {
        const { context, page } = await fresh();
        await call(context, "POST", "/api/advent/participants", asOfDay(1));
        await signIn(context, asOfDay(1));
        for (let n = 1; n <= Math.min(3, today - 3); n += 1) await playDayApi(context, n, asOfDay(n));
        await open(page, asOfDay(today));
        await shot(page, `03-day${today}-facade`);
        if (!facadeOnly) {
          await door(page, today).click();
          await page.getByRole("dialog").waitFor();
          await shot(page, "04-day-story");
        }
        await context.close();
      }
      if (facadeOnly) return;
      // 05. Задание «собери» (build или order): экран дня на обложке с чашкой, коробкой или стопкой.
      const buildDay = advent.days.find((day) => day.blocks.some((block) => block.type === "task" && (block.task.type === "build" || block.task.type === "order")))?.n ?? firstDayWith("task")!;
      {
        const { context, page } = await fresh();
        await call(context, "POST", "/api/advent/participants", asOfDay(1));
        await signIn(context, asOfDay(1));
        for (let n = 1; n < buildDay; n += 1) await playDayApi(context, n, asOfDay(n));
        await open(page, asOfDay(buildDay));
        await door(page, buildDay).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        await finishSpeech(page, copy.chapterNext, dayOf(buildDay).chapter.lines.length, names);
        for (const block of dayOf(buildDay).blocks) {
          if (block.type === "story") await finishSpeech(page, copy.storyNext, block.lines.length, names);
          if (block.type === "task") break;
        }
        const task = (dayOf(buildDay).blocks.find((block) => block.type === "task") as Extract<Block, { type: "task" }>).task;
        // Часть слоёв уже выбрана: на кадре видно, как наполняется ёмкость.
        if (task.type === "build" || task.type === "order") {
          const ids = task.type === "build" ? task.options.filter((option) => (correctPayload(task) as { optionIds: string[] }).optionIds.includes(option.id)) : task.items.filter((item) => (correctPayload(task) as { orderedIds: string[] }).orderedIds.slice(0, 2).includes(item.id));
          for (const entry of ids.slice(0, 2)) await dialog.getByRole("list", { name: copy.skinBuildTitle }).getByRole("button", { name: entry.title, exact: true }).click();
        }
        await shot(page, "05-day-task-build");
        await context.close();
      }
    } else {
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
      const luckLabel = { boxes: copy.luckBoxLabel, wheel: copy.luckSectorLabel, scratch: copy.luckCardLabel }[advent.luck?.skin ?? "boxes"];
      await dialog.getByRole("button", { name: new RegExp(`^${luckLabel.replace("{i}", "2")}`) }).click();
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

/** Эскейп для HTML-подписей (названия дней приходят из пакета). */
const html = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Скриншоты каждого дня: глава, блоки и итог. Участник вошёл по ссылке (если есть Mailpit): удача и подарок показываются целиком. */
async function runDays(name: ProfileName, days: number[]) {
  const browser = await launch();
  const converter = await (await browser.newContext()).newPage();
  const context = await browser.newContext({
    ...profiles[name],
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` }
  });
  const page = await context.newPage();
  const shots: Array<{ day: number; caption: string; file: string; data: string }> = [];
  let signedIn = true;
  try {
    await call(context, "POST", "/api/advent/participants", asOfDay(days[0]));
    try {
      await signIn(context, asOfDay(days[0]));
    } catch (error) {
      signedIn = false;
      console.warn(`  Вход по ссылке недоступен (${error instanceof Error ? error.message : String(error)}): удача и подарок покажут только «сохранить прогресс».`);
    }
    for (const n of days) {
      const day = dayOf(n);
      const tag = String(n).padStart(2, "0");
      const take = async (step: string, caption: string) => {
        await page.waitForTimeout(700);
        const webp = await toWebp(converter, await page.screenshot());
        const file = `${name}-day-${tag}-${step}.webp`;
        writeFileSync(path.join(outDir, file), webp);
        shots.push({ day: n, caption, file, data: webp.toString("base64") });
        console.log(`  ${file} (${Math.round(webp.length / 1024)} КБ)`);
      };
      await page.goto(`/?asOf=${encodeURIComponent(asOfDay(n))}`);
      await page.waitForSelector(mainSelector);
      await take("0-calendar", "Календарь в этот день");
      await page.locator(`[data-door="${n}"]`).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await take("1-chapter", "Глава истории");
      await finishSpeech(page, copy.chapterNext, day.chapter.lines.length, names);
      let blocked = false;
      for (const [index, block] of day.blocks.entries()) {
        if (blocked) break;
        const step = `${index + 2}-${block.type}`;
        if (block.type === "story") {
          await take(step, "История");
          await finishSpeech(page, copy.storyNext, block.lines.length, names);
        } else if (block.type === "task") {
          await take(step, "Задание");
          await fillTask(page, block.task, names);
          await dialog.getByRole("heading", { level: 3, name: copy.outcomePerfect }).waitFor();
          await take(`${step}-answer`, "Разбор после верного ответа");
          await dialog.getByRole("button", { name: copy.outcomeNext, exact: true }).click();
        } else if (block.type === "luck") {
          await take(step, "Удача: выбор");
          await dialog.getByRole("button", { name: new RegExp(`^${copy.luckBoxLabel.replace("{i}", "1")}|^${copy.luckSectorLabel.replace("{i}", "1")}|^${copy.luckCardLabel.replace("{i}", "1")}`) }).click();
          if (signedIn) {
            await dialog.getByText(copy.luckWon).waitFor();
            await page.waitForTimeout(1500);
            await take(`${step}-result`, "Удача: исход");
            await dialog.getByRole("button", { name: copy.outcomeNext, exact: true }).click();
          } else {
            await dialog.getByRole("region", { name: copy.saveTitle }).waitFor();
            await take(`${step}-identity`, "Удача: нужен вход по email");
            blocked = true;
          }
        } else if (block.type === "promo") {
          await take(step, "Подарок дня: закрыт");
          await dialog.getByRole("button", { name: copy.promoOpen }).click();
          if (signedIn) {
            await dialog.getByTestId("promo-code").waitFor();
            await page.waitForTimeout(900);
            await take(`${step}-result`, "Подарок дня: код");
            await dialog.getByRole("button", { name: copy.outcomeNext, exact: true }).click();
          } else {
            await dialog.getByRole("region", { name: copy.saveTitle }).waitFor();
            await take(`${step}-identity`, "Подарок дня: нужен вход по email");
            blocked = true;
          }
        }
      }
      if (!blocked) {
        await dialog.getByRole("heading", { level: 3, name: copy.dayDoneTitle }).waitFor();
        await take("9-done", "Итог дня");
      }
      await page.keyboard.press("Escape");
    }
  } finally {
    await browser.close();
  }
  return shots;
}

function writeIndex(shots: Awaited<ReturnType<typeof runDays>>, days: number[]) {
  const sections = days.map((n) => {
    const day = dayOf(n);
    const items = shots.filter((shot) => shot.day === n);
    return `<section><h2>День ${n}. ${html(day.title)}</h2><p class="meta">${html(day.teaser)} · блоки: ${day.blocks.map((block) => block.type).join(", ")}${day.rewardId ? ` · награда дня: ${html(advent.rewards.find((reward) => reward.id === day.rewardId)?.label ?? day.rewardId)}` : ""}</p><div class="row">${items
      .map((shot) => `<figure><img alt="${html(shot.caption)}" src="data:image/webp;base64,${shot.data}"><figcaption>${html(shot.caption)}</figcaption></figure>`)
      .join("")}</div></section>`;
  });
  const page = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Скриншоты: ${html(advent.title)}</title>
<style>body{margin:0;padding:24px;background:#14100c;color:#f2ead9;font:15px/1.5 system-ui,sans-serif}h1{margin:0 0 4px}h2{margin:32px 0 4px}.meta{margin:0 0 12px;color:#bfae92}.row{display:flex;gap:14px;overflow-x:auto;padding-bottom:12px}figure{margin:0;flex:none;width:260px}img{width:100%;border-radius:14px;border:1px solid #3a2e22}figcaption{margin-top:6px;font-size:13px;color:#bfae92}</style></head>
<body><h1>${html(advent.title)}</h1><p class="meta">Пакет ${html(slug!)} · скриншоты дней ${days[0]}–${days[days.length - 1]} · сняты командой quiz:shots с ?asOf= (демо-время)</p>${sections.join("")}</body></html>`;
  const file = path.join(outDir, "index.html");
  writeFileSync(file, page);
  console.log(`  ${path.relative(process.cwd(), file)} (${Math.round(page.length / 1024)} КБ, один файл со всеми кадрами)`);
}

if (dayList) {
  for (const name of withDesktop ? (Object.keys(profiles) as ProfileName[]) : (["mobile"] as ProfileName[])) {
    console.log(`\n${name} (дни ${dayList[0]}–${dayList[dayList.length - 1]}):`);
    const shots = await runDays(name, dayList);
    if (name === "mobile") writeIndex(shots, dayList);
  }
} else {
  for (const name of Object.keys(profiles) as ProfileName[]) await run(name);
}
console.log(`\nГотово: ${outDir}`);
