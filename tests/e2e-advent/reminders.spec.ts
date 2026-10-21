import { execFileSync } from "node:child_process";

import type { APIRequestContext } from "@playwright/test";

import { localEnv, mailpitUrl } from "../e2e/support/env";
import {
  advent,
  asOfDay,
  confirmLogin,
  copy,
  expect,
  gotoDay,
  marketingLabel,
  playDay,
  sheet,
  submitSaveProgress,
  test,
  tenantSlug,
  uniqueEmail
} from "./support/advent";

// Напоминания (A5): запуск `npm run advent:remind` с часами asOf → письмо в Mailpit → кнопка: без cookie — страница «войдите»
// и свежая ссылка входа на адрес владельца (входа по ссылке письма нет), с cookie — сразу на день → отписка → повторный запуск
// писем не шлёт. Процесс рассылки — тот же скрипт, что и в deploy/compose.yml.
test.describe("напоминания на почту", () => {
  test.skip(advent.reminders.channel !== "email", "в пакете напоминания выключены");

  /** Запуск рассылки в «момент» asOf: тот же скрипт, что крутит cron. Демо-пакеты пишут письма только при явном флаге. */
  function runReminders(asOf: string): string {
    return execFileSync("npx", ["tsx", "scripts/advent-remind.ts"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...localEnv,
        TENANT: tenantSlug,
        NODE_ENV: "development",
        ADVENT_REMINDERS_DEMO: "true",
        ADVENT_REMIND_AS_OF: asOf,
        REMINDER_RATE_PER_SECOND: "0"
      },
      timeout: 120_000
    });
  }

  type Mail = { ID: string; Subject: string; To?: Array<{ Address: string }> };
  async function mailsTo(request: APIRequestContext, address: string): Promise<Mail[]> {
    const response = await request.get(`${mailpitUrl}/api/v1/search`, { params: { query: `to:"${address}"` } });
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { messages: Mail[] }).messages;
  }

  const day2 = advent.days[1];
  const subject = advent.reminders.subject.replace("{day}", "2").replace("{teaser}", day2.teaser);

  test("письмо → кнопка без cookie → «Прислать ссылку» → ссылка владельцу → вход и день письма → с cookie сразу → отписка → повторный запуск не шлёт", async ({ page, request, browser, isMobile }) => {
    test.skip(isMobile, "рассылка не зависит от размера экрана: один прогон, на десктопе");
    test.setTimeout(240_000);
    const email = uniqueEmail("remind");

    // Подписка: первый день, «Сохранить прогресс» с отметкой напоминаний, вход по ссылке на этом устройстве.
    await gotoDay(page, 1);
    await playDay(page, 1);
    await submitSaveProgress(page, email, { marketing: true });
    await confirmLogin(page.context(), request, email, asOfDay(1));

    // Время рассылки ещё не наступило — писем нет; в окне рассылки — одно письмо; повторный запуск его не дублирует.
    runReminders(asOfDay(2, 0));
    expect((await mailsTo(request, email)).filter((mail) => mail.Subject === subject)).toHaveLength(0);
    runReminders(asOfDay(2, 11));
    await expect.poll(async () => (await mailsTo(request, email)).filter((mail) => mail.Subject === subject).length, { message: "письмо-напоминание не пришло" }).toBe(1);
    runReminders(asOfDay(2, 11));
    runReminders(asOfDay(2, 12));
    expect((await mailsTo(request, email)).filter((mail) => mail.Subject === subject)).toHaveLength(1);

    const reminder = (await mailsTo(request, email)).find((mail) => mail.Subject === subject)!;
    const message = (await (await request.get(`${mailpitUrl}/api/v1/message/${reminder.ID}`)).json()) as { Text: string; HTML: string };
    const headers = (await (await request.get(`${mailpitUrl}/api/v1/message/${reminder.ID}/headers`)).json()) as Record<string, string[]>;
    expect(headers["List-Unsubscribe-Post"]).toEqual(["List-Unsubscribe=One-Click"]);
    expect(headers["List-Unsubscribe"]?.[0]?.trim()).toMatch(/^<https?:\/\/\S+\/api\/advent\/unsubscribe\/one-click\?t=[\w-]+>$/);

    // В письме: бренд, анонс дня, кнопка «Открыть …», прогресс «k из N», отписка и оператор; ни подарков, ни кодов.
    expect(message.Text).toContain(advent.brand.name);
    expect(message.Text).toContain(day2.teaser);
    expect(message.Text).toContain(advent.reminders.button.replace("{day}", "2"));
    expect(message.Text).toMatch(new RegExp(`Открыто \\d+ из ${advent.schedule.days}`));
    expect(message.Text).toContain("Отписаться: ");
    expect(message.Text).toContain(advent.legal.operatorName);
    for (const reward of advent.rewards) expect(message.Text + message.HTML).not.toContain(reward.label);
    expect(message.HTML).toContain('lang="ru"');

    const buttonLink = message.Text.match(/https?:\/\/\S+\/api\/advent\/reminders\/open\?\S+/)?.[0];
    const unsubscribeLink = message.Text.match(/https?:\/\/\S+\/unsubscribe\?t=[\w-]+/)?.[0];
    expect(buttonLink, "в письме нет кнопки").toBeTruthy();
    expect(unsubscribeLink, "в письме нет ссылки отписки").toBeTruthy();
    // Ссылки ведут на хост пакета (*.localhost открывается и в Chromium): тем же хостом ведём и сайт, чтобы cookie входа не потерялась.
    const siteOrigin = new URL(buttonLink!).origin;
    const local = (link: string) => `${new URL(link).pathname}${new URL(link).search}`;

    // В кнопке письма нет ссылки входа: только непрозрачный идентификатор доставки.
    expect([...new URL(buttonLink!).searchParams.keys()]).toEqual(["r"]);

    // Кнопка с нового устройства (без cookie, например пересланное письмо): страница «войдите», входа нет, адрес не показан.
    const phone = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.${1 + Math.floor(Math.random() * 253)}.7.7` }, baseURL: localEnv.APP_URL });
    const mobile = await phone.newPage();
    await mobile.goto(buttonLink!);
    await expect(mobile).toHaveURL(/\/reminder\?/);
    await expect(mobile.getByRole("heading", { level: 1 })).toHaveText(copy.reminderLoginTitle.replace("{day}", "2"));
    await expect(mobile.locator("body")).not.toContainText(email);
    await expect(mobile.locator('input[type="email"]')).toHaveCount(0);

    // «Прислать ссылку для входа» (POST) — свежая ссылка входа уходит на подтверждённый адрес владельца письма.
    const loginSubject = `${advent.brand.name}: вход по ссылке`;
    const loginsBefore = (await mailsTo(request, email)).filter((mail) => mail.Subject === loginSubject).length;
    await mobile.getByRole("button", { name: copy.reminderLoginButton }).click();
    await expect(mobile).toHaveURL(/\/reminder\?sent=1$/);
    await expect(mobile.getByRole("heading", { level: 1, name: copy.reminderLoginSentTitle })).toBeVisible();
    await expect.poll(async () => (await mailsTo(request, email)).filter((mail) => mail.Subject === loginSubject).length, { message: "письмо со ссылкой входа не пришло владельцу" }).toBe(loginsBefore + 1);
    const loginMail = (await mailsTo(request, email)).find((mail) => mail.Subject === loginSubject)!;
    const loginText = ((await (await request.get(`${mailpitUrl}/api/v1/message/${loginMail.ID}`)).json()) as { Text: string }).Text;
    const loginLink = loginText.match(/https?:\/\/\S+\/api\/advent\/identity\/verify\?token=[\w-]+&r=[\w-]+/)?.[0];
    expect(loginLink, "в письме нет ссылки входа с днём письма").toBeTruthy();

    // Владелец открывает ссылку на этом устройстве: «Войти» → сайт на дне письма.
    await mobile.goto(loginLink!);
    await expect(mobile).toHaveURL(/\/login\?/);
    // Адрес с ?day=2 живёт недолго (клиент убирает параметр), поэтому переход проверяем по ответу сервера.
    const verified = mobile.waitForResponse((response) => response.url().endsWith("/api/advent/identity/verify") && response.request().method() === "POST");
    await mobile.getByRole("button", { name: "Войти" }).click();
    const redirect = await verified;
    expect(redirect.status()).toBe(303);
    expect(redirect.headers().location).toMatch(/\/\?day=2$/);
    // На сайте (время кампании — asOf) тот же день открывается сразу, а параметр убирается из адреса.
    await mobile.goto(`${siteOrigin}/?asOf=${encodeURIComponent(asOfDay(2, 11))}&day=2`);
    await expect(sheet(mobile)).toBeVisible();
    await expect(mobile).not.toHaveURL(/day=/);
    // Повторное нажатие кнопки уже на устройстве, где выполнен вход (cookie того же участника): сразу на сайт.
    const again = mobile.waitForResponse((response) => response.url().includes("/api/advent/reminders/open"));
    await mobile.goto(buttonLink!);
    const direct = await again;
    expect(direct.status()).toBe(303);
    expect(direct.headers().location).toMatch(/\/\?day=2$/);
    await phone.close();

    // Первое устройство владельца не «выбросило»: оно по-прежнему вошло, кнопка письма ведёт сразу на день.
    const first = page.waitForResponse((response) => response.url().includes("/api/advent/reminders/open"));
    await page.goto(local(buttonLink!));
    expect((await first).headers().location).toMatch(/\/\?day=2$/);

    // Метрики оператора: письмо отправлено, переход засчитан один раз, день открыт после письма.
    const auth = `Basic ${Buffer.from(`${localEnv.ADMIN_USERNAME}:${localEnv.ADMIN_PASSWORD}`).toString("base64")}`;
    const metrics = (await (await request.get("/api/admin/advent/metrics", { headers: { authorization: auth } })).json()) as {
      reminders: { subscribed: number; days: Array<{ day: number; sent: number; clicked: number; openedAfter: number }> };
    };
    expect(metrics.reminders.subscribed).toBeGreaterThanOrEqual(1);
    expect(metrics.reminders.days.find((row) => row.day === 2)).toMatchObject({ sent: expect.any(Number), clicked: expect.any(Number) });
    expect(metrics.reminders.days.find((row) => row.day === 2)!.clicked).toBeGreaterThanOrEqual(1);

    // Отписка: страница с кнопкой (GET ничего не меняет), POST отключает напоминания.
    await page.goto(local(unsubscribeLink!));
    await expect(page.getByRole("heading", { level: 1, name: "Отписаться от напоминаний?" })).toBeVisible();
    await page.getByRole("button", { name: "Отписаться" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Вы отписались" })).toBeVisible();
    await expect(page).toHaveURL(/\/unsubscribe\?done=1$/);

    // Следующий день: отписавшемуся письма нет.
    const before = (await mailsTo(request, email)).length;
    runReminders(asOfDay(3, 11));
    expect((await mailsTo(request, email)).length).toBe(before);

    // Включить снова можно переключателем в листе серии (на сайте, под тем же входом).
    await page.goto(`/?asOf=${encodeURIComponent(asOfDay(3, 11))}`);
    const toggle = page.getByRole("checkbox", { name: copy.remindersToggle });
    if (advent.presentation === "storefront") await page.getByRole("button", { name: /Подробнее о серии/ }).click();
    await expect(toggle).not.toBeChecked();
    // Отписка отозвала согласие на рассылку: включение сначала показывает его текст, запрос — по «Согласен(на), включить».
    // Состояние переключателя приходит с сервера, поэтому click и ожидание, а не check().
    await toggle.click();
    await expect(page.getByText(marketingLabel)).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await page.getByRole("button", { name: copy.remindersConsentAccept }).click();
    await expect(toggle).toBeChecked();
    runReminders(asOfDay(3, 11));
    await expect.poll(async () => (await mailsTo(request, email)).length).toBe(before + 1);
  });
});
