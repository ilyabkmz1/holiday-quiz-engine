import { expect, test, advent, asOfBeforeStart, asOfClosed, asOfDay, asOfFinale, copy, door, doorsOf, gotoAt, gotoDay, schedule, sheet, storefront } from "./support/advent";

/** Статус двери без участия игрока (ничего не открыто) на день `today` по правилам догоняния пакета. */
function expectedStatus(n: number, today: number): string {
  if (n > today) return "locked";
  if (n === today) return "today";
  const { catchUp } = schedule;
  if (catchUp === "all") return "catchup";
  if (catchUp !== "none" && today - n <= catchUp.window) return "catchup";
  return "missed";
}

test.describe("календарь адвента", () => {
  test("до старта: отсчёт до первого дня, все двери закрыты", async ({ page }) => {
    await gotoAt(page, asOfBeforeStart);
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^Адвент откроется \d+ [а-я]+$/ })).toBeVisible();
    await expect(doorsOf(page)).toHaveCount(schedule.days);
    await expect(doorsOf(page).and(page.locator('[data-status="locked"]'))).toHaveCount(schedule.days);
  });

  test("в середине адвента: статусы дверей различаются значком, формой и подписью, а не только цветом", async ({ page }) => {
    const today = 3;
    await gotoDay(page, today);
    const shapes = new Set<string>();
    const icons = new Set<string>();
    for (let n = 1; n <= schedule.days; n += 1) {
      const status = expectedStatus(n, today);
      const button = door(page, n);
      await expect(button, `дверь ${n}`).toHaveAttribute("data-status", status);
      shapes.add((await button.getAttribute("data-shape"))!);
      if (storefront && status === "today") {
        // У сегодняшнего окна «Витрины» значка нет (звезда — знак финала): его отличают лента и подпись «Сегодня».
        await expect(button.locator(".adv-ribbon")).toHaveCount(1);
        await expect(button.locator("svg[data-icon]")).toHaveCount(0);
        icons.add("ribbon");
      } else {
        icons.add((await button.locator("svg").first().getAttribute("data-icon"))!);
      }
      await expect(button).toHaveAccessibleName(new RegExp(`^${storefront ? "Окно" : "День"} ${n}: `));
    }
    const statuses = new Set(Array.from({ length: schedule.days }, (_, index) => expectedStatus(index + 1, today)));
    expect(shapes.size).toBe(statuses.size);
    expect(icons.size).toBe(statuses.size);
    await expect(door(page, today)).toContainText(storefront ? copy.windowToday : copy.doorToday);
  });

  test("клавиатура: Tab входит в сетку, стрелки двигают фокус, Enter открывает лист, Escape возвращает фокус", async ({ page }) => {
    await gotoDay(page, 2);
    const today = door(page, 2);
    await today.focus();
    await page.keyboard.press("ArrowRight");
    await expect(door(page, 3)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(today).toBeFocused();
    await page.keyboard.press("End");
    await expect(door(page, schedule.days)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(door(page, 1)).toBeFocused();
    // Закрытая дверь объясняет, когда откроется, и лист не открывает.
    await door(page, 3).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: /Откроется/ })).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    // Сегодняшняя дверь открывается с клавиатуры.
    await today.focus();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(today).toBeFocused();
  });

  test("после финала — итоги, после закрытия — «адвент завершён»; двери не открываются", async ({ page }) => {
    await gotoAt(page, asOfFinale);
    await expect(page.getByRole("heading", { level: 2, name: copy.finaleTitle })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.finaleShare })).toBeVisible();
    // Дверь помечена aria-disabled: клик «по-человечески» (force) всё равно должен объяснить, почему она не открывается.
    await door(page, schedule.days).click({ force: true });
    await expect(sheet(page)).toHaveCount(0);
    await gotoAt(page, asOfClosed);
    await expect(page.getByRole("heading", { level: 2, name: copy.closedTitle })).toBeVisible();
  });

  test("перезагрузка: тот же участник и то же состояние, участник не создаётся заново", async ({ page }) => {
    await gotoDay(page, 1);
    const before = await page.context().cookies();
    expect(before.some((cookie) => cookie.name === "advent_participant_access")).toBe(true);
    await door(page, 1).click();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(door(page, 1)).toHaveAttribute("data-status", "opened");
    const after = await page.context().cookies();
    expect(after.find((cookie) => cookie.name === "advent_participant_access")?.value).toBe(before.find((cookie) => cookie.name === "advent_participant_access")?.value);
  });

  test("фон не доступен, пока лист открыт, и на странице нет ошибок консоли", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await gotoAt(page, asOfDay(1));
    await door(page, 1).click();
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator("main.adv-main")).toHaveAttribute("inert", "");
    expect(errors).toEqual([]);
    expect(advent.days).toHaveLength(schedule.days);
  });
});
