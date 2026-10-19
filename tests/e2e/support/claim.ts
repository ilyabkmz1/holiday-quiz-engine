import { randomUUID } from "node:crypto";

import { expect, type APIRequestContext, type Page, type Response } from "@playwright/test";

import { localEnv } from "./env";

export const claimForm = (page: Page) => ({
  name: page.getByLabel("Имя"),
  company: page.getByLabel("Компания"),
  email: page.getByLabel("Корпоративный email"),
  consent: page.getByRole("checkbox"),
  submit: page.getByRole("button", { name: "Получить ссылку подтверждения" })
});

export function uniqueEmail(prefix = "player"): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

type ClaimInput = { name?: string; company?: string; email: string; consent?: boolean };

export async function fillClaimForm(page: Page, input: ClaimInput) {
  const form = claimForm(page);
  await form.name.fill(input.name ?? "Анна Тестова");
  await form.company.fill(input.company ?? "ООО «Тест»");
  await form.email.fill(input.email);
  if (input.consent ?? true) await form.consent.check();
}

/** Отправляет форму и возвращает ответ API заявки. */
export async function submitClaim(page: Page, input: ClaimInput): Promise<Response> {
  await fillClaimForm(page, input);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.request().method() === "POST" && /\/api\/sessions\/[^/]+\/claim$/.test(new URL(candidate.url()).pathname)
    ),
    claimForm(page).submit.click()
  ]);
  return response;
}

export async function expectClaimSent(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: "Письмо уже в пути" })).toBeVisible();
}

/** Строки операторской CSV для адреса. Как кнопка в админке: сначала POST «выгружено», затем GET (CSV статус не меняет). */
export async function exportedRowsFor(request: APIRequestContext, email: string): Promise<string[]> {
  const credentials = Buffer.from(`${localEnv.ADMIN_USERNAME}:${localEnv.ADMIN_PASSWORD}`).toString("base64");
  const headers = { authorization: `Basic ${credentials}` };
  const mark = await request.post("/api/admin/claims/export", { headers: { ...headers, origin: new URL(localEnv.APP_URL).origin } });
  expect(mark.ok()).toBe(true);
  const response = await request.get("/api/admin/claims.csv", { headers });
  expect(response.ok()).toBe(true);
  return (await response.text()).split(/\r?\n/).filter((line) => line.toLowerCase().includes(email.toLowerCase()));
}
