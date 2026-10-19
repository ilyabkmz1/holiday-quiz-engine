import { expect, type Page } from "@playwright/test";

import { campaign } from "./tenant";
import type { CreateSessionResponse, GetSessionResponse, PublicTask, TaskPayloadBody } from "../../../src/types/api";
import { localEnv } from "./env";
import { CARDS_URL, payloadFor, rooms, shuffledRoomOrder, type CampaignTask, type Plan } from "./game";

/** Текст, по которому вариант узнаётся независимо от id и порядка в ответе API. */
const textOf = (item: { title: string } | { address: string }) => ("title" in item ? item.title : item.address);

function publicItems(task: PublicTask): Array<{ id: string; title: string } | { id: string; address: string }> {
  switch (task.type) {
    case "pick":
    case "build":
      return task.options;
    case "phish":
      return task.letters;
    case "access":
      return task.switches;
    case "order":
      return task.items;
  }
}

function configItems(task: CampaignTask): Array<{ id: string; title: string } | { id: string; address: string }> {
  switch (task.type) {
    case "pick":
    case "build":
      return [...task.options];
    case "phish":
      return [...task.letters];
    case "access":
      return [...task.switches];
    case "order":
      return [...task.items];
  }
}

/** Ответ по плану: id из конфигурации переводятся в id публичного задания через текст варианта. */
export function translatePayload(config: CampaignTask, shown: PublicTask, plan: Plan): TaskPayloadBody {
  const map = (id: string) => {
    const text = textOf(configItems(config).find((item) => item.id === id)!);
    const found = publicItems(shown).find((item) => textOf(item) === text);
    expect(found, `вариант «${text}» есть в публичном задании`).toBeTruthy();
    return found!.id;
  };
  const payload = payloadFor(config, plan) as Record<string, string | string[]>;
  if ("optionId" in payload) return { optionId: map(payload.optionId as string) };
  if ("optionIds" in payload) return { optionIds: (payload.optionIds as string[]).map(map) };
  if ("enabledIds" in payload) return { enabledIds: (payload.enabledIds as string[]).map(map) };
  return { orderedIds: (payload.orderedIds as string[]).map(map) };
}

const post = (page: Page, path: string, data?: unknown) =>
  page.request.post(path, { headers: { origin: localEnv.APP_URL }, data });

export async function getState(page: Page, sessionId: string): Promise<GetSessionResponse> {
  const response = await page.request.get(`/api/sessions/${sessionId}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as GetSessionResponse;
}

/** Создаёт сессию через API (cookie попадает в контекст браузера) и запоминает её id в localStorage. */
export async function createSessionViaApi(page: Page, url = CARDS_URL): Promise<string> {
  // Сначала забываем прежнюю игру: иначе её загрузка с новой cookie (401) сотрёт id новой сессии.
  await page.goto(url);
  await page.evaluate(() => window.localStorage.clear());
  const response = await post(page, "/api/sessions");
  expect(response.ok()).toBe(true);
  const { sessionId } = (await response.json()) as CreateSessionResponse;
  await page.evaluate((id) => window.localStorage.setItem("hqe-holiday-quiz-session", id), sessionId);
  return sessionId;
}

export async function playRoomViaApi(page: Page, sessionId: string, roomId: string, plans: Plan[] = ["correct", "correct", "correct"], count = 3) {
  const room = rooms.find((candidate) => candidate.id === roomId)!;
  expect((await post(page, `/api/sessions/${sessionId}/rooms/${roomId}/enter`)).ok()).toBe(true);
  for (let index = 0; index < Math.min(count, room.tasks.length); index += 1) {
    const taskResponse = await page.request.get(`/api/sessions/${sessionId}/rooms/${roomId}/task`);
    const { task } = (await taskResponse.json()) as { task: PublicTask };
    const config = room.tasks[index];
    const answer = await post(page, `/api/sessions/${sessionId}/answers`, {
      taskId: task.id,
      payload: translatePayload(config, task, plans[index])
    });
    expect(answer.ok(), await answer.text()).toBe(true);
  }
}

export async function playAllRoomsViaApi(page: Page, sessionId: string, plans?: Plan[]) {
  for (const room of shuffledRoomOrder) await playRoomViaApi(page, sessionId, room.id, plans);
}

export async function startRushViaApi(page: Page, sessionId: string) {
  const response = await post(page, `/api/sessions/${sessionId}/rush/start`);
  expect(response.ok()).toBe(true);
}

/** Отвечает на заявки рывка: `misses` первых — неверно, остальные верно, пока пул не кончится. */
export async function playRushViaApi(page: Page, sessionId: string, misses = 0) {
  for (let step = 0; step < campaign.rush.pool.length; step += 1) {
    const { session } = await getState(page, sessionId);
    const current = session.rush?.current;
    if (!current) break;
    const item = campaign.rush.pool.find((candidate) => candidate.id === current.itemId)!;
    const wrong = campaign.rush.services.find((service) => service.id !== item.serviceId)!;
    const serviceId = step < misses ? wrong.id : item.serviceId;
    expect((await post(page, `/api/sessions/${sessionId}/rush/answer`, { itemId: current.itemId, serviceId })).ok()).toBe(true);
  }
}

/** Быстрый путь к финалу: все комнаты и рывок через API, затем перезагрузка — игра восстанавливается на экране результата. */
export async function reachFinalViaApi(page: Page, plans?: Plan[]): Promise<string> {
  const sessionId = await createSessionViaApi(page);
  await playAllRoomsViaApi(page, sessionId, plans);
  await startRushViaApi(page, sessionId);
  await playRushViaApi(page, sessionId);
  await page.reload();
  await expect(page.getByLabel("Результат")).toBeVisible({ timeout: 30_000 });
  return sessionId;
}
