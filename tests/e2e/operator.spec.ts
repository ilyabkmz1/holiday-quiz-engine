import { campaign } from "./support/tenant";
import { claimViaApi, adminAuthorization, adminCredentials, finishGameViaApi } from "./support/operator";
import { uniqueEmail } from "./support/claim";
import { expect, test } from "./support/fixtures";

test.describe("панель оператора", () => {
  test("без пароля /admin отвечает 401 с Basic-вызовом, с неверным — тоже", async ({ request }) => {
    const anonymous = await request.get("/admin");
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()["www-authenticate"]).toMatch(/^Basic /);

    const wrong = await request.get("/admin", { headers: { authorization: `Basic ${Buffer.from("operator:wrong-password-16+chars").toString("base64")}` } });
    expect(wrong.status()).toBe(401);
  });

  test("с ADMIN-авторизацией открывается дашборд с воронкой, заданиями и заявками", async ({ browser }) => {
    const context = await browser.newContext({ httpCredentials: adminCredentials });
    const page = await context.newPage();
    try {
      const response = await page.goto("/admin");
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: campaign.title })).toBeVisible();
      for (const name of ["Воронка", "По дням", "Уровни", "Время прохождения", "Задания"]) {
        await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
      }
      await expect(page.getByRole("heading", { level: 2, name: /^Заявки/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Выгрузить CSV" })).toBeEnabled();
      // Страница не должна быть шире экрана: прокрутка допустима только внутри таблиц.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });

  test("заявка в таблице видна только с маской email, полный адрес не попадает в страницу", async ({ browser, page }) => {
    const sessionId = await finishGameViaApi(page);
    const email = uniqueEmail("opr");
    await claimViaApi(page, sessionId, email);

    const context = await browser.newContext({ httpCredentials: adminCredentials });
    const admin = await context.newPage();
    try {
      await admin.goto("/admin");
      const html = await admin.content();
      expect(html).not.toContain(email);
      expect(html).not.toContain(email.split("@")[0]);
      await expect(admin.getByRole("rowheader", { name: "o***@example.test" }).first()).toBeVisible();
      await expect(admin.getByRole("heading", { level: 2, name: /^Заявки · [1-9]/ })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("API по-прежнему принимает ADMIN и не принимает пустой заголовок", async ({ request }) => {
    expect((await request.get("/api/admin/metrics")).status()).toBe(401);
    expect((await request.get("/api/admin/metrics", { headers: { authorization: adminAuthorization() } })).status()).toBe(200);
  });
});
