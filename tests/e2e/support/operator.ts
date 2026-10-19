import { expect, type Page } from "@playwright/test";

import { localEnv } from "./env";
import { createSessionViaApi, playAllRoomsViaApi, playRushViaApi, startRushViaApi } from "./api";

const post = (page: Page, path: string, data?: unknown) =>
  page.request.post(path, { headers: { origin: localEnv.APP_URL }, data });

/** Заголовок ADMIN Basic auth для API-запросов. */
export const adminAuthorization = () =>
  `Basic ${Buffer.from(`${localEnv.ADMIN_USERNAME}:${localEnv.ADMIN_PASSWORD}`).toString("base64")}`;

/** Учётные данные оператора для контекста браузера (`test.use({ httpCredentials })`). */
export const adminCredentials = { username: localEnv.ADMIN_USERNAME, password: localEnv.ADMIN_PASSWORD };

/** Проходит игру целиком через API (комнаты, рывок, финализация) без участия интерфейса. */
export async function finishGameViaApi(page: Page): Promise<string> {
  const sessionId = await createSessionViaApi(page);
  await playAllRoomsViaApi(page, sessionId);
  await startRushViaApi(page, sessionId);
  await playRushViaApi(page, sessionId);
  expect((await post(page, `/api/sessions/${sessionId}/rush/finish`)).ok()).toBe(true);
  const complete = await post(page, `/api/sessions/${sessionId}/complete`);
  expect(complete.ok(), await complete.text()).toBe(true);
  return sessionId;
}

/** Создаёт заявку на приз для завершённой сессии. */
export async function claimViaApi(page: Page, sessionId: string, email: string): Promise<void> {
  const response = await post(page, `/api/sessions/${sessionId}/claim`, {
    name: "Оператор Тестов",
    email,
    company: "ООО «Операторская»",
    consent: true
  });
  expect(response.ok(), await response.text()).toBe(true);
}
