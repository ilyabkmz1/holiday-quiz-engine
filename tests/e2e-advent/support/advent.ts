import { expect, test as base, type APIRequestContext, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { adventPackSchema } from "../../../src/config/pack";
import { correctPayload } from "../../../src/domain/solve";
import { asOfForDay } from "../../../src/tools/advent-asof";
import { packs } from "../../../tenants/index";
import { localEnv, mailpitUrl } from "../../e2e/support/env";

export { expect };

/**
 * `test` с отдельным «IP клиента» на каждый тест: лимиты на создание участника и запрос ссылки считаются по `x-forwarded-for`,
 * а параллельные тесты одного прогона иначе делили бы один адрес и упирались в лимит друг друга.
 */
export const test = base.extend({
  context: async ({ context }, run) => {
    const octet = () => 1 + Math.floor(Math.random() * 253);
    await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` });
    await run(context);
  }
});

/** Арендатор прогона: `E2E_TENANT=<slug>` (по умолчанию демо-кофейня). Тексты и селекторы берутся из его пакета. */
export const tenantSlug = process.env.E2E_TENANT ?? "demo-coffee-advent";

const raw = (packs as Array<{ tenant?: string }>).find((item) => item.tenant === tenantSlug);
if (!raw) throw new Error(`E2E_TENANT=${tenantSlug}: такого пакета нет в tenants/index.ts`);
export const pack = adventPackSchema.parse(raw);
export const advent = pack.advent;
export const { copy, schedule } = advent;
export type PackTask = Extract<(typeof advent.days)[number]["blocks"][number], { type: "task" }>["task"];

/** Нужен ли вход по ссылке для наград пакета (как `rewardNeedsIdentity`: код, остаток или погашение на кассе). */
export const packNeedsIdentity = advent.rewards.some(
  (reward) => reward.codes !== undefined || reward.stock !== undefined || reward.redeem === "cashier" || reward.redeem === "both"
);

/** Момент `hour`:00 по времени кампании в день n (день 1 — `startDate`), в виде ISO со смещением для `?asOf=`. */
export const asOfDay = (n: number, hour = 12): string => asOfForDay(schedule, n, hour);

/** Момент после финала (через час) и после закрытия выдачи (через час). */
export const asOfFinale = new Date(new Date(schedule.finaleAt).getTime() + 3_600_000).toISOString();
export const asOfClosed = new Date(new Date(schedule.claimEndsAt).getTime() + 3_600_000).toISOString();
/** За сутки до старта. */
export const asOfBeforeStart = new Date(new Date(asOfDay(1, 0)).getTime() - 24 * 3_600_000).toISOString();

export const door = (page: Page, n: number): Locator => page.locator(`[data-door="${n}"]`);
export const sheet = (page: Page): Locator => page.getByRole("dialog");

/** Главная адвента «как в этот момент». */
export async function gotoAt(page: Page, asOf: string) {
  await page.goto(`/?asOf=${encodeURIComponent(asOf)}`);
  await expect(page.getByRole("heading", { level: 1, name: advent.title })).toBeVisible();
}

export async function gotoDay(page: Page, n: number) {
  await gotoAt(page, asOfDay(n));
  await expect(page.locator(".adv-doors")).toBeVisible();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function control(page: Page, group: string, title: string, role: "button" | "switch" = "button"): Locator {
  return page.getByRole("group", { name: group }).getByRole(role, { name: title, exact: true });
}

/** Действия игрока по заданию вместе с отправкой ответа. Варианты выбираются по тексту из пакета. */
export async function fillTask(page: Page, task: PackTask) {
  const payload = correctPayload(task);
  switch (task.type) {
    case "pick": {
      const id = (payload as { optionId: string }).optionId;
      await control(page, "Варианты ответа", task.options.find((option) => option.id === id)!.title).click();
      return;
    }
    case "phish": {
      const id = (payload as { optionId: string }).optionId;
      const letter = task.letters.find((item) => item.id === id)!;
      await page.getByRole("group", { name: "Входящие письма" }).getByRole("button", { name: new RegExp(escapeRegExp(letter.address)) }).click();
      await page.getByRole("button", { name: "Это подделка — в карантин" }).click();
      return;
    }
    case "build": {
      for (const id of (payload as { optionIds: string[] }).optionIds) {
        await control(page, "Карточки сценария", task.options.find((option) => option.id === id)!.title).click();
      }
      await page.getByRole("button", { name: "Запустить сценарий", exact: true }).click();
      return;
    }
    case "access": {
      for (const id of (payload as { enabledIds: string[] }).enabledIds) {
        await control(page, "Настройки доступа", task.switches.find((item) => item.id === id)!.title, "switch").click();
      }
      await page.getByRole("button", { name: "Применить настройки" }).click();
      return;
    }
    case "order": {
      for (const id of (payload as { orderedIds: string[] }).orderedIds) {
        await control(page, "Шаги", task.items.find((item) => item.id === id)!.title).click();
      }
      await page.getByRole("button", { name: "Подтвердить порядок" }).click();
      return;
    }
  }
}

/** Пройти день n через интерфейс: глава → блоки по порядку → «День пройден». Дверь открывает сам. */
export async function playDay(page: Page, n: number) {
  const day = advent.days.find((candidate) => candidate.n === n)!;
  await door(page, n).click();
  await expect(sheet(page)).toBeVisible();
  const dialog = sheet(page);
  await dialog.getByRole("button", { name: copy.chapterNext, exact: true }).click();
  for (const block of day.blocks) {
    switch (block.type) {
      case "story":
        await dialog.getByRole("button", { name: copy.storyNext, exact: true }).click();
        break;
      case "task":
        await fillTask(page, block.task);
        await expect(dialog.getByRole("heading", { level: 3, name: copy.outcomePerfect })).toBeVisible();
        await dialog.getByRole("button", { name: copy.outcomeNext }).click();
        break;
      case "luck":
        await dialog.getByRole("button", { name: new RegExp(`^${escapeRegExp(copy.luckBoxLabel.replace("{i}", "1"))}`) }).click();
        await expect(dialog.getByText(copy.luckWon)).toBeVisible();
        await dialog.getByRole("button", { name: copy.outcomeNext }).click();
        break;
      case "promo":
        await dialog.getByRole("button", { name: copy.promoOpen }).click();
        await expect(dialog.getByTestId("promo-code")).toBeVisible();
        await dialog.getByRole("button", { name: copy.outcomeNext }).click();
        break;
    }
  }
  await expect(dialog.getByRole("heading", { level: 3, name: copy.dayDoneTitle })).toBeVisible();
}

export function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.test`;
}

/** Ссылка входа из письма на адрес (письмо ждём в Mailpit). */
export async function loginLinkFor(request: APIRequestContext, address: string): Promise<string> {
  let messageId = "";
  await expect
    .poll(async () => {
      const response = await request.get(`${mailpitUrl}/api/v1/search`, { params: { query: `to:"${address}"` } });
      messageId = ((await response.json()) as { messages: Array<{ ID: string }> }).messages[0]?.ID ?? "";
      return messageId;
    }, { message: `письмо для ${address} не пришло в Mailpit` })
    .not.toBe("");
  const response = await request.get(`${mailpitUrl}/api/v1/message/${messageId}`);
  const message = (await response.json()) as { Text: string };
  const link = message.Text.match(/https?:\/\/\S+\/api\/advent\/identity\/verify\?token=[\w-]+/)?.[0];
  expect(link, "в письме нет ссылки входа").toBeTruthy();
  return link!;
}

/** Заполняет «Сохранить прогресс» и отправляет ссылку. */
export async function submitSaveProgress(page: Page, email: string, options: { marketing?: boolean } = {}) {
  const card = page.getByRole("region", { name: copy.saveTitle });
  await card.getByLabel(copy.saveEmail, { exact: true }).fill(email);
  await card.getByRole("checkbox", { name: copy.saveConsent }).check();
  if (options.marketing) await card.getByRole("checkbox", { name: copy.saveMarketing }).check();
  await card.getByRole("button", { name: copy.saveSubmit }).click();
  await expect(page.getByRole("heading", { name: copy.saveSentTitle })).toBeVisible();
}

/**
 * Подтверждает ссылку из письма на этом устройстве: тратит токен тем же запросом, что кнопка «Войти» на `/login`
 * (форма POST), и сохраняет cookie в контексте. Время сдвигается заголовком: срок ссылки считается от `asOf`.
 */
export async function confirmLogin(context: BrowserContext, request: APIRequestContext, email: string, asOf: string) {
  const link = await loginLinkFor(request, email);
  const token = new URL(link).searchParams.get("token")!;
  const response = await context.request.post("/api/advent/identity/verify", {
    form: { token },
    headers: { "x-advent-as-of": asOf, origin: localEnv.APP_URL },
    maxRedirects: 0
  });
  expect(response.status()).toBe(303);
  expect(new URL(response.headers().location).search).not.toContain("login=error");
}

/** Анонимный участник входит по почте целиком: форма «Сохранить прогресс» уже на экране. */
export async function loginFromSaveCard(page: Page, request: APIRequestContext, asOf: string) {
  const email = uniqueEmail("login");
  await submitSaveProgress(page, email);
  await confirmLogin(page.context(), request, email, asOf);
  return email;
}

/** Серверное состояние участника устройства (для проверок, которых нет в интерфейсе). */
export async function stateOf(page: Page, asOf: string) {
  const response = await page.context().request.get("/api/advent/state", { headers: { "x-advent-as-of": asOf } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as import("../../../src/types/advent").AdventState;
}
