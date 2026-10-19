import { reachFinalViaApi, createSessionViaApi } from "./support/api";
import { expect, test } from "./support/fixtures";
import { mapHeading, rooms } from "./support/game";

const animationNames = (page: import("@playwright/test").Page, selector: string) =>
  page.locator(selector).evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName));

test.describe("prefers-reduced-motion: reduce", () => {
  test.use({ reducedMotion: "reduce" });

  test("пульсация комнат на карте и снег в финале не анимируются, переходы нулевые", async ({ page }) => {
    await createSessionViaApi(page);
    await page.reload();
    await expect(mapHeading(page)).toBeVisible();
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const hot = await animationNames(page, ".hot");
    expect(hot.length).toBe(rooms.length);
    expect(new Set(hot)).toEqual(new Set(["none"]));
    const transitions = await page.locator(".btn, .hot").evaluateAll((els) => els.map((el) => Number.parseFloat(getComputedStyle(el).transitionDuration)));
    for (const duration of transitions) expect(duration).toBeLessThan(0.001);

    await reachFinalViaApi(page);
    const snow = await animationNames(page, ".flake");
    expect(snow.length).toBeGreaterThan(0);
    expect(new Set(snow)).toEqual(new Set(["none"]));
  });
});

test.describe("без prefers-reduced-motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("контроль: комнаты пульсируют, снег идёт — значит проверка выше что-то измеряет", async ({ page }) => {
    await createSessionViaApi(page);
    await page.reload();
    await expect(mapHeading(page)).toBeVisible();
    expect(new Set(await animationNames(page, ".hot"))).toEqual(new Set(["pulse"]));
    await reachFinalViaApi(page);
    expect(new Set(await animationNames(page, ".flake"))).toEqual(new Set(["fall"]));
  });
});
