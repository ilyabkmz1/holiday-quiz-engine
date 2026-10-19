import {
  advent,
  asOfDay,
  asOfFinale,
  copy,
  door,
  needsIdentity,
  dayOneReward,
  gotoAt,
  gotoDay,
  loginFromSaveCard,
  packNeedsIdentity,
  playDay,
  schedule,
  sheet,
  stateOf,
  submitSaveProgress,
  uniqueEmail,
  expect,
  test
} from "./support/advent";

test.describe("путь участника", () => {
  test("12 дней подряд: первый день анонимно, вход по почте, все двери, финал", async ({ page, request, isMobile }) => {
    test.skip(isMobile, "полный путь — один раз, на десктопе: мобильный экран покрывают остальные сценарии");
    test.setTimeout(300_000);
    let signedIn = false;

    for (let n = 1; n <= schedule.days; n += 1) {
      await gotoDay(page, n);
      await playDay(page, n);

      if (n === 1) {
        // После первого дня предлагают сохранить прогресс; награда дня, если требует вход, ждёт его.
        const dialog = sheet(page);
        await expect(dialog.getByRole("region", { name: copy.saveTitle })).toBeVisible();
        if (packNeedsIdentity) {
          if (needsIdentity(dayOneReward)) await expect(dialog.getByText(copy.promoNeedsIdentity)).toBeVisible();
          await loginFromSaveCard(page, request, asOfDay(1));
          signedIn = true;
        }
      }
      await page.keyboard.press("Escape");
      await expect(door(page, n)).toHaveAttribute("data-status", "opened");
    }

    await gotoDay(page, schedule.days);
    await expect(page.locator('.adv-door[data-status="opened"]')).toHaveCount(schedule.days);
    if (signedIn) await expect(page.getByText(/Прогресс сохранён: /)).toBeVisible();
    await expect(page.getByText(new RegExp(`Открыто ${schedule.days} из ${schedule.days}`))).toBeAttached();

    const state = await stateOf(page, asOfDay(schedule.days));
    expect(state.doors.every((item) => item.completed)).toBe(true);
    expect(state.streak.current).toBe(schedule.days);
    expect(state.goals.every((goal) => goal.reached)).toBe(true);

    // Финал: итоги и главный приз по последней цели.
    await gotoAt(page, asOfFinale);
    await expect(page.getByRole("heading", { level: 2, name: copy.finaleTitle })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: copy.finaleMainPrize })).toBeVisible();
    const lastGoal = [...advent.streak.goals].sort((a, b) => a.opened - b.opened).at(-1);
    if (lastGoal) {
      const reward = advent.rewards.find((item) => item.id === lastGoal.rewardId)!;
      await expect(page.locator(".adv-finale-main")).toContainText(reward.label);
    }
  });

  test("пропуск и догоняние: закрытый день остаётся закрытым, догоняемый открывается, награда только в свой день", async ({ page, request }) => {
    test.skip(typeof schedule.catchUp === "string", "сценарий рассчитан на догоняние окном дней");
    const email = uniqueEmail("catchup");
    // День 1 пройден вовремя анонимно, затем вход по почте.
    await gotoDay(page, 1);
    await playDay(page, 1);
    if (packNeedsIdentity) await loginFromSaveCard(page, request, asOfDay(1));
    else await submitSaveProgress(page, email);

    // Дни 2 и 3 пропущены; сегодня день 4: день 3 можно догнать, день 2 — уже нет.
    await gotoDay(page, 4);
    await expect(door(page, 1)).toHaveAttribute("data-status", "opened");
    await expect(door(page, 2)).toHaveAttribute("data-status", "missed");
    await expect(door(page, 3)).toHaveAttribute("data-status", "catchup");
    await expect(door(page, 4)).toHaveAttribute("data-status", "today");

    await door(page, 2).click({ force: true });
    await expect(page.getByRole("status").filter({ hasText: copy.doorMissedHint })).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);

    await playDay(page, 3);
    await expect(door(page, 3)).toHaveAttribute("data-status", "opened");
  });

  test("догоняние «все»: прошедший день открывается в любой момент", async ({ page }) => {
    test.skip(schedule.catchUp !== "all", "сценарий для пакетов с догонянием «все»");
    await gotoDay(page, 5);
    for (const n of [1, 2, 3, 4]) await expect(door(page, n)).toHaveAttribute("data-status", "catchup");
    await expect(door(page, 5)).toHaveAttribute("data-status", "today");
    await playDay(page, 1);
    await expect(door(page, 1)).toHaveAttribute("data-status", "opened");
  });

  test("возвращение после пропуска: баннер «С возвращением!» при открытии сегодняшней двери", async ({ page, request }) => {
    test.skip(!advent.streak.comebackBonusRewardId, "в пакете нет бонуса за возвращение");
    await gotoDay(page, 1);
    await playDay(page, 1);
    if (packNeedsIdentity) await loginFromSaveCard(page, request, asOfDay(1));
    // Пропущены дни 2 и 3 (заморозка закрывает один, второй рвёт серию): на день 4 положен бонус.
    await gotoDay(page, 4);
    await expect(page.getByRole("status", { name: copy.comebackTitle })).toHaveCount(0);
    await door(page, 4).click();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("status", { name: copy.comebackTitle })).toBeVisible();
    await page.getByRole("button", { name: copy.comebackClose }).click();
    await expect(page.getByRole("status", { name: copy.comebackTitle })).toHaveCount(0);
    // Скрытый баннер не возвращается после перезагрузки.
    await page.reload();
    await expect(door(page, 4)).toHaveAttribute("data-status", "opened");
    await expect(page.getByRole("status", { name: copy.comebackTitle })).toHaveCount(0);
  });
});
