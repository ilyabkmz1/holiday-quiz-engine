import { reachFinalViaApi } from "./support/api";
import { claimForm, exportedRowsFor, expectClaimSent, fillClaimForm, submitClaim, uniqueEmail } from "./support/claim";
import { expect, test } from "./support/fixtures";
import { isQuestTenant } from "./support/tenant";
import { CARDS_URL, openClaim, sessionState, startButton } from "./support/game";
import { messagesFor, verificationLinkFor } from "./support/mailpit";

const claimRequestCounter = (page: import("@playwright/test").Page) => {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/claim$/.test(new URL(request.url()).pathname)) seen.push(request.url());
  });
  return seen;
};

test.describe("валидация формы заявки", () => {
  test.beforeEach(async ({ page }) => {
    await reachFinalViaApi(page);
    await openClaim(page);
  });

  test("пустая форма не отправляется и подсвечивает первое обязательное поле", async ({ page }) => {
    const sent = claimRequestCounter(page);
    const form = claimForm(page);
    await form.submit.click();
    await expect(form.name).toBeFocused();
    for (const field of [form.name, form.company, form.email, form.consent]) {
      expect(await field.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    }
    expect(sent).toHaveLength(0);
  });

  test("email без @ отклоняется браузером до отправки", async ({ page }) => {
    const sent = claimRequestCounter(page);
    const form = claimForm(page);
    await fillClaimForm(page, { email: "plainaddress" });
    await form.submit.click();
    await expect(form.email).toBeFocused();
    expect(await form.email.evaluate((el: HTMLInputElement) => el.validity.typeMismatch)).toBe(true);
    expect(sent).toHaveLength(0);
  });

  test("email, который проходит проверку браузера, но не сервера, показывает ошибку", async ({ page, request }) => {
    const form = claimForm(page);
    const response = await submitClaim(page, { email: "user@localhost" });
    expect(response.status()).toBe(400);
    await expect(page.getByRole("alert").filter({ hasText: "Проверьте заполнение полей." })).toBeVisible();
    await expect(form.submit).toBeEnabled();
    expect(await messagesFor(request, "user@localhost")).toHaveLength(0);
  });

  test("без согласия форма не отправляется", async ({ page }) => {
    const sent = claimRequestCounter(page);
    const form = claimForm(page);
    await fillClaimForm(page, { email: uniqueEmail(), consent: false });
    await form.submit.click();
    await expect(form.consent).toBeFocused();
    expect(sent).toHaveLength(0);
  });

  test("исправленная форма отправляется после неудачных попыток", async ({ page }) => {
    const form = claimForm(page);
    await form.submit.click();
    await expect(form.name).toBeFocused();
    const response = await submitClaim(page, { email: uniqueEmail() });
    expect(response.status()).toBe(200);
    await expectClaimSent(page);
  });
});

test.describe("подтверждение заявки по email", () => {
  test("письмо в Mailpit → ссылка → /verify?status=success, заявка попадает в выгрузку", async ({ page, request }) => {
    const email = uniqueEmail();
    await reachFinalViaApi(page);
    const { session } = await sessionState(page);
    await openClaim(page);

    const response = await submitClaim(page, { email: email.toUpperCase().replace("@EXAMPLE.TEST", "@Example.Test") });
    expect(await response.json()).toMatchObject({ status: "claim_pending", created: true });
    await expectClaimSent(page);
    expect(await exportedRowsFor(request, email)).toHaveLength(0);

    await page.goto(await verificationLinkFor(request, email));
    await expect(page).toHaveURL(/\/verify\?status=success$/);
    await expect(page.getByRole("heading", { level: 1, name: "Результат подтверждён" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Вернуться к квизу" })).toHaveAttribute("href", "/");

    const rows = await exportedRowsFor(request, email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`"${session.final!.score}"`);
    expect(rows[0]).toContain(session.final!.level.title);
  });

  test("повторный переход по уже использованной ссылке не создаёт вторую заявку", async ({ page, request }) => {
    const email = uniqueEmail();
    await reachFinalViaApi(page);
    await openClaim(page);
    await submitClaim(page, { email });
    const link = await verificationLinkFor(request, email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/verify\?status=success$/);
    await page.goto(link);
    // Повторный переход намеренно идемпотентен: почтовые клиенты сами открывают ссылки из писем.
    await expect(page).toHaveURL(/\/verify\?status=success$/);
    expect(await exportedRowsFor(request, email)).toHaveLength(1);
  });

  test("недействительная и пустая ссылки ведут на страницу ошибки", async ({ page }) => {
    await page.goto(`/api/claims/verify?token=${"x".repeat(32)}`);
    await expect(page).toHaveURL(/\/verify\?status=error$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ссылка не сработала" })).toBeVisible();
    await page.goto("/api/claims/verify");
    await expect(page).toHaveURL(/\/verify\?status=error$/);
    await page.getByRole("link", { name: "Вернуться к квизу" }).click();
    // Главная открывается режимом кампании: у квест-кампаний новый игрок начинает с пролога, у карточных — с лендинга.
    if (isQuestTenant) await expect(page.locator("main.quest")).toHaveAttribute("data-phase", "prologue");
    else await expect(startButton(page)).toBeVisible();
    await page.goto(CARDS_URL);
    await expect(startButton(page)).toBeVisible();
  });

  test("второй игрок с тем же email не получает ссылку и не создаёт вторую заявку", async ({ page, request, context }) => {
    const email = uniqueEmail();
    await reachFinalViaApi(page);
    const first = (await sessionState(page)).session.final!.score;
    await openClaim(page);
    expect((await (await submitClaim(page, { email })).json()).created).toBe(true);
    const link = await verificationLinkFor(request, email);
    expect(await messagesFor(request, email)).toHaveLength(1);

    // Игрок 2 — чистый профиль и худший результат.
    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    await reachFinalViaApi(page, ["wrong", "wrong", "wrong"]);
    const second = (await sessionState(page)).session.final!.score;
    expect(second).toBeLessThan(first);
    await openClaim(page);
    const response = await submitClaim(page, { email: email.toUpperCase() });

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ created: false });
    await expectClaimSent(page);
    expect(await messagesFor(request, email)).toHaveLength(1);

    await page.goto(link);
    await expect(page).toHaveURL(/\/verify\?status=success$/);
    const rows = await exportedRowsFor(request, email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`"${first}"`);
  });
});
