import { expect, type Page } from "@playwright/test";

import { campaign, copy, story } from "./tenant";
import { escapeRegExp, fillTask, expectReveal, outcomeFor, rooms, shuffledOrder, type CampaignRoom, type Plan } from "./game";

/** Режим квеста — основной: главная открывается им по умолчанию. */
export const QUEST_URL = "/";

export const questPhase = (page: Page) => page.locator("main.quest");
export const expectPhase = (page: Page, phase: string, timeout = 20_000) =>
  expect(questPhase(page)).toHaveAttribute("data-phase", phase, { timeout });

/** Пролог: общий план шара, робот слетает, герой пролога объясняет правила, обучающий тап MFA, вход в офис. */
export async function startQuest(page: Page, url = QUEST_URL) {
  await page.goto(url);
  await expectPhase(page, "prologue");
  await page.getByRole("button", { name: "Дальше" }).click();
  // Полёт робота и приближение камеры к персонажу; затем реплики героя пролога.
  const next = page.getByRole("button", { name: "Дальше" });
  for (let step = 1; step < campaign.prologue.lines.length; step += 1) await next.click();
  await page.getByRole("switch").click();
  await page.getByRole("button", { name: "Войти в офис" }).click();
  await expectPhase(page, "explore");
  await expect(page.getByRole("heading", { level: 1, name: story.placeTitle })).toBeVisible();
}

export const roomListButton = (page: Page) => page.getByRole("button", { name: "Список комнат" });
export const sheet = (page: Page, room: CampaignRoom) => page.getByRole("dialog", { name: `Заявка в комнате «${room.title}»` });

/** Клавиатурный путь: «Список комнат» → комната → «Помочь» → карточка заявки. */
export async function openRoomViaList(page: Page, room: CampaignRoom, press: "click" | "keyboard" = "click") {
  await roomListButton(page).click();
  const item = page.getByRole("dialog", { name: "Список комнат" }).getByRole("button", { name: new RegExp(escapeRegExp(room.title)) });
  await item.click();
  const help = page.getByRole("button", { name: /^Помочь:/ });
  await expect(help).toBeVisible();
  if (press === "keyboard") {
    await help.focus();
    await page.keyboard.press("Enter");
  } else {
    await help.click();
  }
  await expect(sheet(page, room)).toBeVisible();
}

/** Три задания комнаты: ответ → разбор → дальше → итог комнаты → праздник → мир (или вступление в рывок). */
export async function playQuestRoom(page: Page, room: CampaignRoom, plans: Plan[] = ["correct", "correct", "correct"], last = false) {
  await openRoomViaList(page, room);
  for (let index = 0; index < room.tasks.length; index += 1) {
    const task = room.tasks[index];
    await expect(page.locator(".qw-hud").getByText(`${room.title} · заявка ${index + 1} из 3`)).toBeVisible();
    await fillTask(page, task, plans[index]);
    await expectReveal(page, outcomeFor(task, plans[index]));
    await page.getByRole("button", { name: index === room.tasks.length - 1 ? "Включить свет в комнате" : "Следующая заявка" }).click();
  }
  await expect(page.getByRole("heading", { level: 2, name: `${room.title}: свет включён` })).toBeVisible();
  await page.getByRole("button", { name: copy.hangOrnament }).click();
  await expectPhase(page, last ? "rushIntro" : "explore", 30_000);
  await expect(page.locator(`.qw-room[data-room="${room.id}"]`)).toHaveAttribute("data-lit", "true");
}

export const questRoomOrder: CampaignRoom[] = shuffledOrder(rooms);

export async function playAllQuestRooms(page: Page, plans?: Plan[]) {
  for (const [index, room] of questRoomOrder.entries()) await playQuestRoom(page, room, plans, index === questRoomOrder.length - 1);
}

/** Рывок у ёлки: заявка всплывает над героем, ответ — тап по сервису-комнате. */
export async function startQuestRush(page: Page) {
  await page.getByRole("button", { name: "Поехали!" }).click();
  await expectPhase(page, "rush");
  await expect(page.locator('.qw-bubble[data-bubble="rush-prompt"]')).toBeVisible();
}

export async function questRushPrompt(page: Page): Promise<string> {
  const bubble = page.locator('.qw-bubble[data-bubble="rush-prompt"]');
  await expect(bubble).toBeVisible();
  const text = (await bubble.textContent()) ?? "";
  const item = campaign.rush.pool.find((candidate) => text.includes(candidate.prompt));
  expect(item, `заявка рывка в облачке: «${text}»`).toBeTruthy();
  return item!.prompt;
}

export async function answerQuestRush(page: Page, correct: boolean) {
  const prompt = await questRushPrompt(page);
  const item = campaign.rush.pool.find((candidate) => candidate.prompt === prompt)!;
  const service = correct
    ? campaign.rush.services.find((s) => s.id === item.serviceId)!
    : campaign.rush.services.find((s) => s.id !== item.serviceId)!;
  await page.getByRole("group", { name: "Сервисы" }).getByRole("button", { name: service.title, exact: true }).click();
  return prompt;
}

export async function playQuestRushToEnd(page: Page) {
  for (let index = 0; index < campaign.rush.pool.length; index += 1) {
    const prompt = await answerQuestRush(page, true);
    if (index < campaign.rush.pool.length - 1) await expect(page.locator('.qw-bubble[data-bubble="rush-prompt"]')).not.toContainText(prompt);
  }
}

export const finalResult = (page: Page) => page.getByLabel("Результат", { exact: true });

/** Весь квест до финала: пролог, пять комнат, рывок. */
export async function completeQuest(page: Page, plans?: Plan[]) {
  await startQuest(page);
  await playAllQuestRooms(page, plans);
  await startQuestRush(page);
  await playQuestRushToEnd(page);
  await expectPhase(page, "final", 40_000);
  await expect(finalResult(page)).toBeVisible();
}

/** Быстрый путь к финалу квеста: комнаты и рывок через API, затем перезагрузка — игра восстанавливается на итоге. */
export async function reachQuestFinalViaApi(page: Page, plans?: Plan[]): Promise<string> {
  const { createSessionViaApi, playAllRoomsViaApi, playRushViaApi, startRushViaApi } = await import("./api");
  const sessionId = await createSessionViaApi(page, QUEST_URL);
  await playAllRoomsViaApi(page, sessionId, plans);
  await startRushViaApi(page, sessionId);
  await playRushViaApi(page, sessionId);
  await page.reload();
  await expectPhase(page, "final", 30_000);
  await expect(finalResult(page)).toBeVisible();
  return sessionId;
}
