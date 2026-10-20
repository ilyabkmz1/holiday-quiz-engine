import {
  advent,
  asOfDay,
  copy,
  door,
  fillTask,
  gotoDay,
  passChapter,
  passStory,
  loginFromSaveCard,
  luckItemName,
  rewardByLabel,
  packNeedsIdentity,
  playDay,
  sheet,
  type PackTask,
  expect,
  test
} from "./support/advent";

const luckDay = advent.days.find((day) => day.blocks.some((block) => block.type === "luck"));
const promoDay = advent.days.find((day) => day.blocks.some((block) => block.type === "promo"));
const luckLabels = advent.rewards.filter((reward) => advent.days.some((day) => day.blocks.some((block) => block.type === "luck" && block.pool.some((item) => item.rewardId === reward.id)))).map((reward) => reward.label);

/** До блока удачи (или подарка) в дне: глава и блоки, идущие раньше. */
async function reachBlock(page: import("@playwright/test").Page, day: NonNullable<typeof luckDay>, type: "luck" | "promo") {
  await door(page, day.n).click();
  const dialog = sheet(page);
  await expect(dialog).toBeVisible();
  await passChapter(page, day.n);
  for (const block of day.blocks) {
    if (block.type === type) return;
    if (block.type === "story") await passStory(page, block.lines.length);
    if (block.type === "task") {
      await fillTask(page, (block as { task: PackTask }).task);
      await dialog.getByRole("button", { name: copy.outcomeNext, exact: true }).click();
    }
  }
}

test.describe("награды", () => {
  test("удача: до ответа сервера результата нет, после — фактический исход, код и QR, и всё это переживает перезагрузку", async ({ page, request }) => {
    test.skip(!luckDay, "в пакете нет блока удачи");
    const day = luckDay!;
    // Участник входит по почте (иначе сервер отвечает identity_required).
    await gotoDay(page, 1);
    await playDay(page, 1);
    await loginFromSaveCard(page, request, asOfDay(1));
    await gotoDay(page, day.n);
    await reachBlock(page, day, "luck");
    const dialog = sheet(page);

    // Ответ сервера придерживаем: пока он не пришёл, исхода и анимации раскрытия быть не должно.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/advent/days/${day.n}/blocks/*`, async (route) => {
      await held;
      await route.continue();
    });
    const luckBlockIndex = day.blocks.findIndex((block) => block.type === "luck");
    const pending = page.waitForResponse((response) => response.url().includes(`/blocks/${luckBlockIndex}`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: luckItemName(2) }).click();
    await expect(dialog.locator(".adv-luck")).toHaveAttribute("data-phase", "pending");
    await expect(dialog.getByText(copy.luckWon)).toHaveCount(0);
    await expect(dialog.locator('.adv-luck-item[data-state="open"]')).toHaveCount(0);
    for (const label of luckLabels) await expect(dialog.getByText(label)).toHaveCount(0);
    release();
    await pending;

    await expect(dialog.getByText(copy.luckWon)).toBeVisible();
    await expect(dialog.locator(".adv-luck")).toHaveAttribute("data-phase", "reveal");
    const prize = dialog.locator(".adv-promo");
    await expect(prize).toBeVisible();
    const label = (await prize.getByRole("heading", { level: 3 }).textContent())!.trim();
    expect(luckLabels).toContain(label);
    const reward = rewardByLabel(label)!;
    // Код, срок и QR — только у награды, у которой они есть в пакете.
    let code = "";
    if (reward.codes) {
      await expect(prize.getByTestId("promo-code")).toHaveText(/^[A-Z0-9-]{4,}$/);
      code = (await prize.getByTestId("promo-code").textContent())!;
      if (reward.validDays) await expect(prize.getByText(/^Действует до /)).toBeVisible();
    } else {
      await expect(prize.getByTestId("promo-code")).toHaveCount(0);
    }
    if (reward.redeem === "cashier" || reward.redeem === "both") await expect(prize.getByRole("img", { name: copy.promoQrLabel })).toBeVisible();

    await dialog.getByRole("button", { name: copy.outcomeNext, exact: true }).click();
    await expect(dialog.getByRole("heading", { level: 3, name: copy.dayDoneTitle })).toBeVisible();
    await page.keyboard.press("Escape");

    // После перезагрузки та же награда (и код, если он есть) лежит в итоге дня.
    await page.reload();
    await door(page, day.n).click();
    await expect(sheet(page).getByRole("heading", { level: 3, name: label })).toBeVisible();
    if (code) await expect(sheet(page).getByTestId("promo-code")).toHaveText(code);
  });

  test("удача без входа: сервер отвечает identity_required, приз не разыгран, показывается «Сохранить прогресс»", async ({ page }) => {
    test.skip(!luckDay || !packNeedsIdentity, "нужен блок удачи с наградой, требующей вход");
    const day = luckDay!;
    await gotoDay(page, day.n);
    await reachBlock(page, day, "luck");
    const dialog = sheet(page);
    await dialog.getByRole("button", { name: luckItemName(1) }).click();
    await expect(dialog.getByRole("region", { name: copy.saveTitle })).toBeVisible();
    await expect(dialog.getByText(copy.saveIdentityRequired)).toBeVisible();
    await expect(dialog.getByText(copy.luckWon)).toHaveCount(0);
    await expect(dialog.locator('.adv-luck-item[data-state="open"]')).toHaveCount(0);
  });

  test("удача при prefers-reduced-motion: результат сразу, без анимации", async ({ page, request }) => {
    test.skip(!luckDay, "в пакете нет блока удачи");
    const day = luckDay!;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoDay(page, 1);
    await playDay(page, 1);
    await loginFromSaveCard(page, request, asOfDay(1));
    await gotoDay(page, day.n);
    await reachBlock(page, day, "luck");
    const dialog = sheet(page);
    await dialog.getByRole("button", { name: luckItemName(3) }).click();
    // Без ожидания анимации раскрытия: исход виден, как только пришёл ответ.
    await expect(dialog.getByText(copy.luckWon)).toBeVisible({ timeout: 3000 });
    await expect(dialog.locator(".adv-burst")).toHaveCount(0);
    await expect(dialog.locator(".adv-promo")).toBeVisible();
  });

  test("подарок дня: код, срок, QR для кассы; код копируется", async ({ page, request, context }) => {
    test.skip(!promoDay, "в пакете нет блока подарка дня");
    const day = promoDay!;
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await gotoDay(page, 1);
    await playDay(page, 1);
    if (packNeedsIdentity) await loginFromSaveCard(page, request, asOfDay(1));
    await gotoDay(page, day.n);
    await reachBlock(page, day, "promo");
    const dialog = sheet(page);
    await dialog.getByRole("button", { name: copy.promoOpen }).click();
    const card = dialog.locator(".adv-promo");
    await expect(card.getByTestId("promo-code")).toBeVisible();
    const reward = advent.rewards.find((item) => item.id === day.blocks.find((block) => block.type === "promo")!.rewardId)!;
    await expect(card.getByRole("heading", { level: 3, name: reward.label })).toBeVisible();
    await expect(card.getByText(/^Действует до /)).toBeVisible();
    if (reward.redeem === "cashier" || reward.redeem === "both") await expect(card.getByRole("img", { name: copy.promoQrLabel })).toBeVisible();
    await card.getByRole("button", { name: copy.promoCopy }).click();
    await expect(page.getByRole("status").filter({ hasText: /^(Код скопирован|Не удалось скопировать)/ }).first()).toBeAttached();
  });
});
