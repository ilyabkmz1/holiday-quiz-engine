import type { Locator, Page } from "@playwright/test";

import { campaign } from "./support/tenant";
import { expect, test } from "./support/fixtures";
import {
  CARDS_URL,
  type CampaignRoom,
  expectReveal,
  fillTask,
  hudEyebrow,
  mapHeading,
  outcomeFor,
  roomSpot,
  rooms,
  startButton,
  type Press
} from "./support/game";
import { expectVisibleFocus, focusByTab } from "./support/keyboard";

/** «Нажатие» только клавиатурой: Tab до элемента, видимый фокус, Enter (Space для переключателей). */
const keyboardPress = (page: Page): Press => async (target: Locator) => {
  await focusByTab(page, target);
  await expectVisibleFocus(page);
  await page.keyboard.press((await target.getAttribute("role")) === "switch" ? "Space" : "Enter");
};

const roomWithType = (type: string) => rooms.find((room) => room.tasks.some((task) => task.type === type))!;
const taskTypes: string[] = [...new Set(rooms.flatMap((room) => room.tasks.map((task) => task.type)))].sort();

/** Комнаты, вместе покрывающие все механики кампании: у demo-office — по комнате на phish, access и order; у остальных добираются недостающие типы. */
function roomsCoveringAllTypes(): CampaignRoom[] {
  const chosen = new Set<CampaignRoom>(["phish", "access", "order"].filter((type) => taskTypes.includes(type)).map(roomWithType));
  const covered = () => new Set<string>([...chosen].flatMap((room) => room.tasks.map((task) => task.type)));
  for (const type of taskTypes) if (!covered().has(type)) chosen.add(roomWithType(type));
  return [...chosen];
}

/** Фокус уже стоит на элементе (без Tab от начала документа), и он виден; затем Enter. */
async function pressFocused(page: Page, target: Locator) {
  await expect(target).toBeFocused();
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");
}

/** Фокус стоит на первом варианте нового задания (внутри группы инструментов). */
async function expectFocusOnFirstOption(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.hand [role="group"]'))))
    .toBe(true);
  await expectVisibleFocus(page);
}

/** Проходит комнату целиком с клавиатуры; возвращает типы заданий, которые были решены. */
async function playRoomWithKeyboard(page: Page, room: CampaignRoom) {
  const press = keyboardPress(page);
  await press(roomSpot(page, room));
  const solved: string[] = [];
  for (const [index, task] of room.tasks.entries()) {
    await expect(hudEyebrow(page, room, index + 1)).toBeVisible();
    // Новая заявка сама забирает фокус на первый вариант: Tab от начала документа не нужен.
    await expectFocusOnFirstOption(page);
    await fillTask(page, task, "correct", press);
    await expectReveal(page, outcomeFor(task, "correct"));
    solved.push(task.type);
    const last = index === room.tasks.length - 1;
    // После ответа фокус переходит на кнопку продолжения (прежние кнопки задания исчезли).
    await pressFocused(page, page.getByRole("button", { name: last ? "Включить свет в комнате" : "Следующая заявка" }));
  }
  await expect(page.getByRole("heading", { level: 2, name: `${room.title}: свет включён` })).toBeVisible();
  await pressFocused(page, page.getByRole("button", { name: /^(Вернуться в офис|К карте: открыт финальный рывок)$/ }));
  await expect(mapHeading(page)).toBeVisible();
  return solved;
}

test("пролог и карта проходятся только с клавиатуры, фокус всегда виден", async ({ page }) => {
  const press = keyboardPress(page);
  await page.goto(CARDS_URL);
  await press(startButton(page));
  for (let step = 1; step < campaign.prologue.lines.length; step += 1) await press(page.getByRole("button", { name: "Дальше" }));
  const mfa = page.getByRole("switch", { name: campaign.prologue.mfa.switchLabel });
  await press(mfa);
  await expect(mfa).toHaveAttribute("aria-checked", "true");
  await press(page.getByRole("button", { name: "К карте офиса" }));
  await expect(mapHeading(page)).toBeVisible();
});

test("с клавиатуры решаются все механики кампании (phish, pick, build, access, order)", async ({ page }) => {
  test.setTimeout(180_000);
  const press = keyboardPress(page);
  await page.goto(CARDS_URL);
  await press(startButton(page));
  for (let step = 1; step < campaign.prologue.lines.length; step += 1) await press(page.getByRole("button", { name: "Дальше" }));
  await press(page.getByRole("switch", { name: campaign.prologue.mfa.switchLabel }));
  await press(page.getByRole("button", { name: "К карте офиса" }));
  await expect(mapHeading(page)).toBeVisible();

  const solved = new Set<string>();
  // Несколько комнат покрывают все механики кампании (у demo-office — все пять).
  for (const room of roomsCoveringAllTypes()) {
    for (const type of await playRoomWithKeyboard(page, room)) solved.add(type);
  }
  expect([...solved].sort()).toEqual(taskTypes);
});

test("цифровые клавиши выбирают карточки pick, Backspace снимает карточку в order", async ({ page }) => {
  const press = keyboardPress(page);
  const { createSessionViaApi, playRoomViaApi } = await import("./support/api");
  await createSessionViaApi(page);

  // Digit 1 в pick.
  const pickRoom = rooms.find((room) => room.tasks[0].type === "pick")!;
  await page.reload();
  await press(roomSpot(page, pickRoom));
  await expect(hudEyebrow(page, pickRoom, 1)).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /Заявка закрыта|Комбо|Почти|Сбой/ })).toBeVisible();

  // order: первое задание комнаты решено по API, перезагрузка возвращает на второе (order).
  await page.evaluate(() => window.localStorage.clear());
  const freshId = await createSessionViaApi(page);
  const orderRoom = roomWithType("order");
  const orderIndex = orderRoom.tasks.findIndex((task) => task.type === "order");
  await playRoomViaApi(page, freshId, orderRoom.id, ["correct", "correct", "correct"], orderIndex);
  await page.reload();
  await expect(hudEyebrow(page, orderRoom, orderIndex + 1)).toBeVisible();
  await page.keyboard.press("2");
  await page.keyboard.press("3");
  await expect(page.getByRole("list", { name: /Выбранный порядок: 2 из/ })).toBeVisible();
  const first = page.getByRole("button", { name: /^Позиция 1: «/ });
  await first.focus();
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("list", { name: /Выбранный порядок: 1 из/ })).toBeVisible();
});
