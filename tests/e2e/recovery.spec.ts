import { randomUUID } from "node:crypto";

import { RUSH } from "../../src/domain/rush";
import { createSessionViaApi, getState, playAllRoomsViaApi, playRoomViaApi, reachFinalViaApi, startRushViaApi } from "./support/api";
import { expect, test } from "./support/fixtures";
import { copy, isQuestTenant, ornamentsCounter } from "./support/tenant";
import {
  CARDS_URL,
  answerRushItem,
  enterRoom,
  expectReveal,
  fillTask,
  gameSessionId,
  hudEyebrow,
  mapHeading,
  nextAfterReveal,
  openRush,
  roomAt,
  rooms,
  startButton,
  startGame
} from "./support/game";

test("перезагрузка на карте сохраняет прогресс и игрушки", async ({ page }) => {
  const id = await createSessionViaApi(page);
  await playRoomViaApi(page, id, roomAt(1).id);
  await page.reload();
  await expect(mapHeading(page)).toBeVisible();
  await expect(page.getByLabel(copy.ornamentsMapLabel).getByRole("img", { name: /на ёлке/ })).toHaveCount(1);
  await expect(page.getByText(ornamentsCounter(1))).toBeVisible();
});

test("перезагрузка на разборе возвращает тот же разбор, а после «дальше» — текущую заявку без повторов", async ({ page }) => {
  await startGame(page);
  const room = rooms[0];
  await enterRoom(page, room);
  await fillTask(page, room.tasks[0], "correct");
  await expectReveal(page, "perfect");
  const scoreBefore = (await getState(page, (await gameSessionId(page))!)).session.score;

  await page.reload();

  // Игрок не нажал «дальше»: тот же разбор, фокус на кнопке продолжения, счёт сохранён.
  await expectReveal(page, "perfect");
  await expect(page.getByText(room.tasks[0].explanation)).toBeVisible();
  await expect(page.getByRole("button", { name: "Следующая заявка" })).toBeFocused();
  await expect(page.getByText(`Очков: ${scoreBefore}`)).toBeAttached();
  await nextAfterReveal(page, false);
  await expect(hudEyebrow(page, room, 2)).toBeVisible();

  // Разбор просмотрен: повторная перезагрузка ведёт на заявку 2 без повторов отвеченных.
  await page.reload();
  await expect(hudEyebrow(page, room, 2)).toBeVisible();
  await expect(page.getByText(room.tasks[0].say)).toHaveCount(0);
  await expect(page.getByText(`Очков: ${scoreBefore}`)).toBeAttached();
  await expect(page.locator(".pill-combo")).toHaveCount(0);

  // Продолжаем и доигрываем комнату.
  await fillTask(page, room.tasks[1], "correct");
  await expectReveal(page, "perfect");
  await nextAfterReveal(page, false);
  await fillTask(page, room.tasks[2], "wrong");
  await expectReveal(page, "miss");
  await nextAfterReveal(page, true);
  await expect(page.getByRole("heading", { level: 2, name: `${room.title}: свет включён` })).toBeVisible();
});

test("после третьего ответа перезагрузка показывает разбор, затем итог комнаты, затем карту", async ({ page }) => {
  await startGame(page);
  const room = rooms[0];
  await enterRoom(page, room);
  for (const [index, task] of room.tasks.entries()) {
    await fillTask(page, task, "correct");
    await expectReveal(page, "perfect");
    if (index < room.tasks.length - 1) await nextAfterReveal(page, false);
  }
  const resultHeading = page.getByRole("heading", { level: 2, name: `${room.title}: свет включён` });

  // Перезагрузка на разборе последнего задания: тот же разбор, а не карта.
  await page.reload();
  await expectReveal(page, "perfect");
  await expect(page.getByText(room.tasks[2].explanation)).toBeVisible();
  await expect(resultHeading).toHaveCount(0);
  await nextAfterReveal(page, true);

  // Перезагрузка на итоге комнаты: итог из данных сервера, не карта.
  await expect(resultHeading).toBeVisible();
  await page.reload();
  await expect(resultHeading).toBeVisible();
  const summary = (await getState(page, (await gameSessionId(page))!)).session.rooms.find((item) => item.roomId === room.id)!.summary!;
  const total = await page.getByText("Итого за комнату").locator("..").getByRole("definition").textContent();
  expect(total?.replace(/\D/g, "")).toBe(String(summary.total));

  await page.getByRole("button", { name: /^(Вернуться в офис|К карте: открыт финальный рывок)$/ }).click();
  await expect(mapHeading(page)).toBeVisible();
  await page.reload();
  await expect(mapHeading(page)).toBeVisible();
  await expect(page.getByText(ornamentsCounter(1))).toBeVisible();
});

test("двойной тап по карточке отправляет ровно один ответ", async ({ page }) => {
  await startGame(page);
  const room = rooms.find((candidate) => candidate.tasks[0].type === "pick")!;
  const task = room.tasks[0];
  if (task.type !== "pick") throw new Error("ожидалось задание pick");
  await enterRoom(page, room);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/answers")) posts.push(request.url());
  });
  const card = page.getByRole("group", { name: "Варианты ответа" }).getByRole("button", { name: task.options[0].title, exact: true });
  await card.dblclick();
  await expectReveal(page, "perfect").catch(() => expectReveal(page, "miss"));
  expect(posts).toHaveLength(1);
  const { session } = await getState(page, (await gameSessionId(page))!);
  expect(session.answers).toHaveLength(1);
});

test("перезагрузка в авале продолжает раунд с серверным таймером и счётом", async ({ page }) => {
  const id = await createSessionViaApi(page);
  await playAllRoomsViaApi(page, id);
  await page.reload();
  await openRush(page);
  const hits = 3;
  for (let step = 0; step < hits; step += 1) {
    const prompt = await answerRushItem(page, true);
    await expect(page.locator(".rush-prompt")).not.toHaveText(prompt);
  }
  const before = (await getState(page, id)).session.rush!;
  expect(before.hits).toBe(hits);

  await page.reload();

  // Без заставки: сразу заявка №4 и серверные числа.
  await expect(page.getByRole("button", { name: "Поехали!" })).toHaveCount(0);
  await expect(page.getByText(`Заявка №${hits + 1}`)).toBeVisible();
  await expect(page.getByText("Закрыто:").locator("span")).toHaveText(String(hits));
  const left = await page.getByRole("timer").first().getAttribute("aria-label");
  expect(Number(left?.match(/(\d+) с/)?.[1])).toBeLessThanOrEqual(before.secondsLeft);
});

test("ошибка в авале отнимает 2 секунды у серверного дедлайна", async ({ page }) => {
  const id = await createSessionViaApi(page);
  await playAllRoomsViaApi(page, id);
  await startRushViaApi(page, id);
  await page.reload();
  const start = (await getState(page, id)).session.rush!;
  const startDeadline = Date.parse(start.deadlineAt);
  await answerRushItem(page, false);
  await expect.poll(async () => (await getState(page, id)).session.rush!.misses).toBe(1);
  expect(Date.parse((await getState(page, id)).session.rush!.deadlineAt)).toBe(startDeadline - RUSH.penaltyMs);
});

test("если время рывка вышло, игра сама завершается и показывает результат", async ({ page }) => {
  test.setTimeout(120_000);
  const id = await createSessionViaApi(page);
  await playAllRoomsViaApi(page, id);
  await startRushViaApi(page, id);
  await page.reload();
  await expect(page.locator(".rush-prompt")).toBeVisible();
  await answerRushItem(page, true);

  await expect(page.getByLabel("Результат")).toBeVisible({ timeout: 60_000 });
  const { session } = await getState(page, id);
  expect(session.status).toBe("completed");
  expect(session.final!.rushHits).toBe(1);
});

test("перезагрузка на финале возвращает результат; переход на /verify и обратно его не ломает", async ({ page }) => {
  await reachFinalViaApi(page);
  const id = (await gameSessionId(page))!;
  const { session } = await getState(page, id);
  await page.reload();
  const finalHeading = page.getByLabel("Результат").getByRole("heading", { level: 1, name: session.final!.level.title });
  await expect(finalHeading).toBeVisible();

  // Страница подтверждения заявки и возврат «к квизу» не сбрасывают сессию: снова тот же результат.
  await page.goto("/verify?status=success");
  await expect(page.getByRole("heading", { level: 1, name: "Результат подтверждён" })).toBeVisible();
  await page.getByRole("link", { name: "Вернуться к квизу" }).click();
  // Ссылка ведёт на главную: у квест-кампаний квест восстанавливает ту же игру на итоге, у карточных — экран результата.
  if (isQuestTenant) await expect(page.locator("main.quest")).toHaveAttribute("data-phase", "final");
  else await expect(finalHeading).toBeVisible();
  await page.goto(CARDS_URL);
  await expect(finalHeading).toBeVisible();
});

test("неизвестная или чужая сессия сбрасывается с понятным сообщением", async ({ page, context }) => {
  await page.goto(CARDS_URL);
  await page.evaluate((id) => window.localStorage.setItem("hqe-holiday-quiz-session", id), randomUUID());
  await page.reload();
  await expect(startButton(page)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Начнём заново" })).toBeVisible();
  expect(await gameSessionId(page)).toBeNull();

  // Cookie доступа пропала (401): тоже новая игра.
  const id = await createSessionViaApi(page);
  await context.clearCookies();
  await page.reload();
  await expect(startButton(page)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Начнём заново" })).toBeVisible();
  expect(await gameSessionId(page)).toBeNull();
  expect(id).toBeTruthy();
});
