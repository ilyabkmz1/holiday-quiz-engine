import { randomInt } from "node:crypto";

import { test as base } from "@playwright/test";

// Публичный rate limit считается по x-forwarded-for. Каждому тесту выдаётся свой
// адрес, как отдельному игроку, иначе полный прогон двух проектов упирается в
// общий лимит 600 запросов в минуту.
export function uniqueClientIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": uniqueClientIp() });
    await provide(context);
  }
});

export { expect } from "@playwright/test";
