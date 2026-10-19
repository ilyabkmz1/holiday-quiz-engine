import { expect, type APIRequestContext } from "@playwright/test";

import { mailpitUrl } from "./env";
import { brand } from "./tenant";

type MessageSummary = { ID: string };

export async function messagesFor(request: APIRequestContext, address: string): Promise<MessageSummary[]> {
  const response = await request.get(`${mailpitUrl}/api/v1/search`, {
    params: { query: `to:"${address}"` }
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { messages: MessageSummary[] };
  return payload.messages;
}

/** Ждёт письмо на адрес и возвращает ссылку подтверждения из его текста. */
export async function verificationLinkFor(request: APIRequestContext, address: string): Promise<string> {
  let messageId = "";
  await expect
    .poll(async () => {
      messageId = (await messagesFor(request, address))[0]?.ID ?? "";
      return messageId;
    }, { message: `письмо для ${address} не пришло в Mailpit` })
    .not.toBe("");
  const response = await request.get(`${mailpitUrl}/api/v1/message/${messageId}`);
  expect(response.ok()).toBe(true);
  const message = (await response.json()) as { Text: string; Subject: string };
  // Тема письма — из пакета арендатора (brand.mailSubject).
  expect(message.Subject).toBe(brand.mailSubject);
  const link = message.Text.match(/https?:\/\/\S+\/api\/claims\/verify\?token=[\w-]+/)?.[0];
  expect(link, "в письме нет ссылки подтверждения").toBeTruthy();
  return link!;
}
