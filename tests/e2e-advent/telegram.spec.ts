import { advent, asOfDay, copy, door, doorsGrid, expect, pack, playDay, sheet, test } from "./support/advent";
import { e2eInitData, installFakeTelegram, tgLog } from "./support/telegram";

// Мини-приложение Telegram: подмена `window.Telegram.WebApp` фейком с настоящим подписанным initData; скрипт telegram.org не грузится.
// Демо-пакет без `platforms.telegram` (команда сотрудников) не участвует.
test.describe("Telegram Mini App", () => {
  test.skip(!pack.platforms.telegram, "в пакете не включён platforms.telegram");

  const rewardDay = advent.days.find((day) => day.blocks.some((block) => block.type === "promo" || block.type === "luck"))!;
  const promoDay = advent.days.find((day) => day.blocks.some((block) => block.type === "promo"));
  const userId = () => 700_000_000 + Math.floor(Math.random() * 99_000_000);

  async function agree(page: import("@playwright/test").Page) {
    await expect(page.getByRole("heading", { level: 1, name: copy.telegramConsentTitle })).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: copy.telegramConsentStart }).click();
    await expect(doorsGrid(page)).toBeVisible();
  }

  test("согласие → фасад → день → промокод без email → BackButton; без cookie и без скрипта telegram.org", async ({ page, context }) => {
    const id = userId();
    const { externalRequests } = await installFakeTelegram(page, e2eInitData(id));
    const day = promoDay ?? rewardDay;
    await page.goto(`/?asOf=${encodeURIComponent(asOfDay(day.n))}`);

    // Первое открытие: согласие, участник пока не создан.
    await agree(page);
    await expect(page.locator(".adv-app")).toHaveAttribute("data-platform", "telegram");
    const log = await tgLog(page);
    expect(log.calls).toEqual(expect.arrayContaining(["ready", "expand"]));
    expect(log.colors.map(([kind]) => kind)).toEqual(expect.arrayContaining(["header", "background"]));
    // Вход по email и напоминания в Telegram скрыты.
    await expect(page.getByText(copy.saveTitle)).toHaveCount(0);

    // День, награда без email.
    await playDay(page, day.n);
    await expect(sheet(page).getByText(copy.saveTitle)).toHaveCount(0);
    expect((await tgLog(page)).haptics).toEqual(expect.arrayContaining(["impact:medium", "notification:success"]));

    // BackButton закрывает лист и возвращает к фасаду.
    const shown = await tgLog(page);
    expect(shown.calls).toContain("back:show");
    await page.evaluate(() => (window as unknown as { __tg: { backClick: () => void } }).__tg.backClick());
    await expect(sheet(page)).toHaveCount(0);
    expect((await tgLog(page)).calls).toContain("back:hide");

    // Прогресс держится на подписи, а не на cookie: без cookie перезагрузка возвращает того же участника без согласия.
    expect((await context.cookies()).filter((cookie) => cookie.name.startsWith("advent_"))).toEqual([]);
    await page.reload();
    await expect(doorsGrid(page)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: copy.telegramConsentTitle })).toHaveCount(0);
    await expect(door(page, day.n)).toHaveAttribute("data-status", "opened");

    expect(externalRequests).toEqual([]);
  });

  test("ссылка на день (startapp=dN) открывает этот день; закрытый день оставляет фасад", async ({ page }) => {
    const id = userId();
    const day = rewardDay;
    await installFakeTelegram(page, e2eInitData(id, `d${day.n}_s_channel`), `d${day.n}_s_channel`);
    await page.goto(`/?asOf=${encodeURIComponent(asOfDay(day.n))}`);
    await agree(page);
    await expect(sheet(page)).toBeVisible();
    await page.evaluate(() => (window as unknown as { __tg: { backClick: () => void } }).__tg.backClick());
    await expect(sheet(page)).toHaveCount(0);
  });

  test("подделанный initData: вход отклонён, участник не создаётся, сообщение пользователю", async ({ page, request }) => {
    const good = e2eInitData(userId());
    const forged = good.replace(/hash=[0-9a-f]{64}/, `hash=${"0".repeat(64)}`);
    await installFakeTelegram(page, forged);
    await page.goto(`/?asOf=${encodeURIComponent(asOfDay(1))}`);
    await expect(page.getByRole("heading", { level: 1, name: copy.telegramConsentTitle })).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: copy.telegramConsentStart }).click();
    await expect(page.locator(".adv-tg-consent .adv-error")).toContainText("Telegram");
    await expect(doorsGrid(page)).toHaveCount(0);
    const direct = await request.get("/api/advent/state", { headers: { "x-telegram-init-data": forged } });
    expect(direct.status()).toBe(401);
  });

  test("обычный веб не изменился: без Telegram нет экрана согласия, скрипта и BackButton", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(`/?asOf=${encodeURIComponent(asOfDay(1))}`);
    await expect(doorsGrid(page)).toBeVisible();
    await expect(page.locator(".adv-app")).toHaveAttribute("data-platform", "web");
    await expect(page.getByRole("heading", { level: 1, name: copy.telegramConsentTitle })).toHaveCount(0);
    expect(requests.filter((url) => url.includes("telegram.org"))).toEqual([]);
  });
});
