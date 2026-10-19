import { expect, type Locator, type Page } from "@playwright/test";

import { campaign, rooms, story } from "./tenant";
import { correctPayload, partialPayload, wrongPayload } from "../../support/solve";

export { rooms };
/** Комната по номеру в конфигурации; для коротких кампаний — последняя (сценарии рассчитаны на 3–5 зон). */
export const roomAt = (index: number) => rooms[Math.min(index, rooms.length - 1)];
export type CampaignRoom = (typeof rooms)[number];
export type CampaignTask = CampaignRoom["tasks"][number];
export const allTasks = rooms.flatMap((room) => room.tasks);

/**
 * Порядок комнат, нестандартный на случай жёсткой привязки к порядку конфигурации.
 * Для пяти зон — фиксированная перестановка (у demo-office это projects, mail, files, calendar, messenger), для меньшего числа — сдвиг на одну.
 */
export function shuffledOrder<T>(items: readonly T[]): T[] {
  if (items.length === 5) return [4, 0, 3, 1, 2].map((index) => items[index]);
  return [items[items.length - 1], ...items.slice(0, -1)];
}
export const shuffledRoomOrder: CampaignRoom[] = shuffledOrder(rooms);

/** Как отвечать: correct — верно (100), partial — ровно одна ошибка (50, если тип позволяет), wrong — мимо (0). */
export type Plan = "correct" | "partial" | "wrong";
export type Outcome = "perfect" | "partial" | "miss";

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function payloadFor(task: CampaignTask, plan: Plan) {
  if (plan === "correct") return correctPayload(task);
  if (plan === "partial") return partialPayload(task) ?? correctPayload(task);
  return wrongPayload(task);
}

export function outcomeFor(task: CampaignTask, plan: Plan): Outcome {
  if (plan === "correct") return "perfect";
  if (plan === "partial") return partialPayload(task) ? "partial" : "perfect";
  return "miss";
}

export const BASE: Record<Outcome, number> = { perfect: 100, partial: 50, miss: 0 };

const REVEAL_TITLES: Record<Outcome, RegExp> = {
  perfect: /^(Заявка закрыта!|Комбо! Офис разгорается)$/,
  partial: /^Почти: сценарий работает частично$/,
  miss: /^Сбой в офисе$/
};

/** Карточный режим (тег v1.0-avral) — вторая редакция игры, включается параметром ?mode=cards. */
export const CARDS_URL = "/?mode=cards";

export const startButton = (page: Page) => page.getByRole("button", { name: "Помочь роботу" });
export const mapHeading = (page: Page) => page.getByRole("heading", { level: 1, name: story.placeTitle });

/** Лендинг → пролог (реплики героя пролога, обучающий тап MFA) → карта. */
export async function startGame(page: Page) {
  await page.goto(CARDS_URL);
  await startButton(page).click();
  const next = page.getByRole("button", { name: "Дальше" });
  for (let step = 1; step < campaign.prologue.lines.length; step += 1) await next.click();
  const mfa = page.getByRole("switch", { name: campaign.prologue.mfa.switchLabel });
  await expect(mfa).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: "К карте офиса" })).toBeDisabled();
  await mfa.click();
  await expect(mfa).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "К карте офиса" }).click();
  await expect(mapHeading(page)).toBeVisible();
}

export const roomSpot = (page: Page, room: CampaignRoom) =>
  page.getByRole("button", { name: new RegExp(`^(Открыть|Продолжить) комнату «${escapeRegExp(room.title)}»`) });

export const hudEyebrow = (page: Page, room: CampaignRoom, number: number) =>
  page.getByText(`${room.title} · заявка ${number} из 3`, { exact: true });

export async function enterRoom(page: Page, room: CampaignRoom, number = 1) {
  await roomSpot(page, room).click();
  await expect(hudEyebrow(page, room, number)).toBeVisible();
}

/** Элемент управления задания по его названию внутри группы. */
export function control(page: Page, group: string, title: string, role: "button" | "switch" = "button"): Locator {
  return page.getByRole("group", { name: group }).getByRole(role, { name: title, exact: true });
}

/** Как «нажать» элемент: по умолчанию кликом, в клавиатурных тестах — через Tab и Enter/Space. */
export type Press = (target: Locator) => Promise<void>;
const click: Press = (target) => target.click();

/** Действия игрока по заданию вместе с отправкой ответа. Варианты выбираются по тексту из конфигурации. */
export async function fillTask(page: Page, task: CampaignTask, plan: Plan, press: Press = click) {
  const payload = payloadFor(task, plan);
  switch (task.type) {
    case "pick": {
      const id = (payload as { optionId: string }).optionId;
      await press(control(page, "Варианты ответа", task.options.find((o) => o.id === id)!.title));
      return;
    }
    case "phish": {
      const id = (payload as { optionId: string }).optionId;
      const letter = task.letters.find((l) => l.id === id)!;
      await press(page.getByRole("group", { name: "Входящие письма" }).getByRole("button", { name: new RegExp(escapeRegExp(letter.address)) }));
      await press(page.getByRole("button", { name: "Это подделка — в карантин" }));
      return;
    }
    case "build": {
      for (const id of (payload as { optionIds: string[] }).optionIds) {
        await press(control(page, "Карточки сценария", task.options.find((o) => o.id === id)!.title));
      }
      await press(page.getByRole("button", { name: "Запустить сценарий", exact: true }));
      return;
    }
    case "access": {
      for (const id of (payload as { enabledIds: string[] }).enabledIds) {
        await press(control(page, "Настройки доступа", task.switches.find((s) => s.id === id)!.title, "switch"));
      }
      await press(page.getByRole("button", { name: "Применить настройки" }));
      return;
    }
    case "order": {
      for (const id of (payload as { orderedIds: string[] }).orderedIds) {
        await press(control(page, "Шаги", task.items.find((i) => i.id === id)!.title));
      }
      await press(page.getByRole("button", { name: "Подтвердить порядок" }));
      return;
    }
  }
}

export async function expectReveal(page: Page, outcome: Outcome) {
  await expect(page.getByRole("heading", { level: 2, name: REVEAL_TITLES[outcome] })).toBeVisible();
  await expect(page.getByText(`Баллы за заявку: ${BASE[outcome]}`)).toBeAttached();
}

export async function nextAfterReveal(page: Page, last: boolean) {
  await page.getByRole("button", { name: last ? "Включить свет в комнате" : "Следующая заявка" }).click();
}

/** Три задания комнаты: ответ → разбор → дальше → итог комнаты → карта. */
export async function playRoom(page: Page, room: CampaignRoom, plans: Plan[] = ["correct", "correct", "correct"]) {
  await enterRoom(page, room);
  for (let index = 0; index < room.tasks.length; index += 1) {
    const task = room.tasks[index];
    if (index > 0) await expect(hudEyebrow(page, room, index + 1)).toBeVisible();
    await fillTask(page, task, plans[index]);
    await expectReveal(page, outcomeFor(task, plans[index]));
    await nextAfterReveal(page, index === room.tasks.length - 1);
  }
  await expect(page.getByRole("heading", { level: 2, name: `${room.title}: свет включён` })).toBeVisible();
  await page.getByRole("button", { name: /^(Вернуться в офис|К карте: открыт финальный рывок)$/ }).click();
  await expect(mapHeading(page)).toBeVisible();
}

export async function playAllRooms(page: Page, order: CampaignRoom[] = shuffledRoomOrder) {
  for (const room of order) await playRoom(page, room);
}

export const rushButton = (page: Page) => page.getByRole("button", { name: "Финал: рывок до полуночи" });

export async function openRush(page: Page) {
  await rushButton(page).click();
  await page.getByRole("button", { name: "Поехали!" }).click();
  await expect(page.locator(".rush-prompt")).toBeVisible();
}

/** Нажимает сервис для текущей заявки рывка: верный или заведомо неверный. */
export async function answerRushItem(page: Page, correct: boolean) {
  const prompt = (await page.locator(".rush-prompt").textContent())!.trim();
  const item = campaign.rush.pool.find((candidate) => candidate.prompt === prompt)!;
  expect(item, `заявка рывка «${prompt}» есть в конфигурации`).toBeTruthy();
  const service = correct
    ? campaign.rush.services.find((s) => s.id === item.serviceId)!
    : campaign.rush.services.find((s) => s.id !== item.serviceId)!;
  await page.getByRole("group", { name: "Сервисы" }).getByRole("button", { name: service.title, exact: true }).click();
  return prompt;
}

/** Проходит рывок: `misses` ошибок вперемешку, остальные заявки верно, пока не кончится пул. */
export async function playRushToEnd(page: Page, misses = 0) {
  let remainingMisses = misses;
  for (let index = 0; index < campaign.rush.pool.length; index += 1) {
    const prompt = await answerRushItem(page, remainingMisses === 0);
    if (remainingMisses > 0) remainingMisses -= 1;
    if (index < campaign.rush.pool.length - 1) await expect(page.locator(".rush-prompt")).not.toHaveText(prompt);
  }
}

export const finalHeading = (page: Page) => page.getByRole("heading", { level: 1 }).filter({ hasText: /./ });

/** Доигрывает до финала: комнаты, рывок; оставляет браузер на экране результата. */
export async function completeGame(page: Page, plans: Plan[] = ["correct", "correct", "correct"]): Promise<void> {
  await startGame(page);
  for (const room of shuffledRoomOrder) await playRoom(page, room, plans);
  await openRush(page);
  await playRushToEnd(page);
  await expect(page.getByLabel("Результат")).toBeVisible({ timeout: 30_000 });
}

export const gameSessionId = (page: Page) =>
  page.evaluate(() => window.localStorage.getItem("hqe-holiday-quiz-session"));

/** Состояние игры по API (для сверки с экраном). */
export async function sessionState(page: Page) {
  const id = await gameSessionId(page);
  expect(id).toBeTruthy();
  const response = await page.request.get(`/api/sessions/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as import("../../../src/types/api").GetSessionResponse;
}

export const claimButton = (page: Page) => page.getByRole("button", { name: "Забрать подарок" });

/** С экрана результата открывает форму заявки на приз. */
export async function openClaim(page: Page) {
  await claimButton(page).click();
  await expect(page.getByRole("heading", { level: 2, name: "Закрепите результат" })).toBeVisible();
}
