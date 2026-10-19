import type { Page } from "@playwright/test";

import { expect, test } from "./support/fixtures";
import {
  CARDS_URL,
  enterRoom,
  expectReveal,
  fillTask,
  mapHeading,
  nextAfterReveal,
  openClaim,
  openRush,
  outcomeFor,
  playRushToEnd,
  rooms,
  shuffledRoomOrder,
  startButton,
  startGame
} from "./support/game";

test.skip(({ isMobile }) => !isMobile, "Проверка горизонтального скролла и тач-целей относится к mobile-проекту");

const viewports = [
  { name: "Pixel 7 (по умолчанию)", size: null },
  { name: "узкий экран 320 px", size: { width: 320, height: 640 } },
  { name: "iPhone 12 mini 375 × 812", size: { width: 375, height: 812 } }
];

async function expectFitsViewport(page: Page, screen: string) {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const viewportWidth = doc.clientWidth;
    const visible = [...document.querySelectorAll<HTMLElement>("h1, h2, button, a, label, [role=switch]")].filter(
      (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden" && !element.closest(".sr-only")
    );
    const clipped = visible
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.left < -1 || rect.right > viewportWidth + 1))
      .map(({ element, rect }) => `${element.tagName}«${(element.textContent ?? "").trim().slice(0, 30)}» ${Math.round(rect.left)}..${Math.round(rect.right)}`);
    const small = visible
      .filter((element) => element.tagName === "BUTTON" || element.getAttribute("role") === "switch")
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.height < 43.5 || rect.width < 43.5))
      .map(({ element, rect }) => `«${(element.textContent ?? element.getAttribute("aria-label") ?? "").trim().slice(0, 30)}» ${Math.round(rect.width)}×${Math.round(rect.height)}`);
    return { scrollWidth: doc.scrollWidth, bodyScrollWidth: document.body.scrollWidth, viewportWidth, clipped, small };
  });
  expect(report.scrollWidth, `${screen}: горизонтальный скролл документа`).toBeLessThanOrEqual(report.viewportWidth);
  expect(report.bodyScrollWidth, `${screen}: горизонтальный скролл body`).toBeLessThanOrEqual(report.viewportWidth);
  expect(report.clipped, `${screen}: элементы выходят за экран ${report.viewportWidth}px`).toEqual([]);
  expect(report.small, `${screen}: тач-цели меньше 44 px`).toEqual([]);
}

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.beforeEach(async ({ page }) => {
      if (viewport.size) await page.setViewportSize(viewport.size);
    });

    test("все экраны игры помещаются по ширине, тач-цели не меньше 44 px", async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto(CARDS_URL);
      await expect(startButton(page)).toBeVisible();
      await expectFitsViewport(page, "лендинг");
      await startButton(page).click();
      await expectFitsViewport(page, "пролог");
      await page.goto(CARDS_URL);
      await startGame(page);
      await expectFitsViewport(page, "карта");

      for (const room of shuffledRoomOrder) {
        await enterRoom(page, room);
        for (const [index, task] of room.tasks.entries()) {
          await expectFitsViewport(page, `${room.title}, заявка ${index + 1} (${task.type})`);
          // Ошибочный ответ даёт самый длинный разбор.
          await fillTask(page, task, index === 0 ? "wrong" : "correct");
          await expectReveal(page, outcomeFor(task, index === 0 ? "wrong" : "correct"));
          await expectFitsViewport(page, `${room.title}, разбор ${index + 1} (${task.type})`);
          await nextAfterReveal(page, index === room.tasks.length - 1);
        }
        await expect(page.getByRole("heading", { level: 2, name: `${room.title}: свет включён` })).toBeVisible();
        await expectFitsViewport(page, `${room.title}: итог комнаты`);
        await page.getByRole("button", { name: /^(Вернуться в офис|К карте: открыт финальный рывок)$/ }).click();
      }
      await expect(mapHeading(page)).toBeVisible();
      await expectFitsViewport(page, "карта: все комнаты светятся");

      await page.getByRole("button", { name: "Финал: рывок до полуночи" }).click();
      await expectFitsViewport(page, "заставка рывка");
      await page.getByRole("button", { name: "Поехали!" }).click();
      await expect(page.locator(".rush-prompt")).toBeVisible();
      await expectFitsViewport(page, "рывок");
      await playRushToEnd(page);
      await expect(page.getByLabel("Результат")).toBeVisible({ timeout: 30_000 });
      await expectFitsViewport(page, "финал");

      await openClaim(page);
      await page.getByRole("button", { name: "Получить ссылку подтверждения" }).click();
      await expectFitsViewport(page, "форма заявки с подсказкой валидации");
      await page.getByRole("button", { name: "← К результату" }).click();
      await page.getByRole("button", { name: "Поделиться результатом" }).click();
      await expectFitsViewport(page, "карточка «Поделиться»");

      for (const status of ["success", "error"]) {
        await page.goto(`/verify?status=${status}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectFitsViewport(page, `подтверждение: ${status}`);
      }
      // Сценарий прошёл каждую комнату кампании ровно по разу.
      expect(shuffledRoomOrder.map((room) => room.id).sort()).toEqual(rooms.map((room) => room.id).sort());
      void openRush;
    });
  });
}
