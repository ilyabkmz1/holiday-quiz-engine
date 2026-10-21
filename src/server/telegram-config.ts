import { createHmac } from "node:crypto";

import type { AdventTenant } from "@/server/tenants";
import { getRuntimeEnv } from "@/server/env";
import { isPreviewEnvironment } from "@/server/env";

/** Заголовок, в котором клиент в Telegram присылает initData в каждом запросе к API адвента. */
export const INIT_DATA_HEADER = "x-telegram-init-data";

/** Ключ разработки для псевдонимизации: только на закрытом стенде, в локальном контуре и вне production. */
export const DEV_PLATFORM_SECRET = "dev-platform-id-secret-not-for-production-0000";

/**
 * Токен бота: сначала свой бот клиента `TELEGRAM_BOT_TOKEN__<ИМЯ_БОТА_ЗАГЛАВНЫМИ>`, затем общий `TELEGRAM_BOT_TOKEN`.
 * Токен берётся только из окружения; в логи и ответы не попадает.
 */
export function telegramBotToken(botUsername: string, source: Record<string, string | undefined> = process.env): string | undefined {
  const own = source[`TELEGRAM_BOT_TOKEN__${botUsername.toUpperCase()}`];
  return own || source.TELEGRAM_BOT_TOKEN || undefined;
}

/** Секрет псевдонимизации идентификаторов платформ или `undefined` (в боевом запуске без `PLATFORM_ID_SECRET`). */
export function platformIdSecret(): string | undefined {
  const env = getRuntimeEnv();
  return env.PLATFORM_ID_SECRET || (isPreviewEnvironment(env) ? DEV_PLATFORM_SECRET : undefined);
}

/**
 * Псевдоним пользователя платформы: HMAC-SHA256 от `платформа:кампания:id` с серверным секретом. Привязан к кампании,
 * поэтому в разных кампаниях один человек даёт разные значения. Обратно в идентификатор не превращается без секрета
 * (но перебор числовых id при утечке секрета возможен: секрет хранится как секрет).
 */
export function subjectHash(platform: "telegram", campaignSlug: string, userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${platform}:${campaignSlug}:${userId}`).digest("hex");
}

export type TelegramSetup = { botToken: string; secret: string; maxAgeSeconds: number };

/** Настройки проверки для арендатора или `null`: Telegram в пакете выключен, нет токена бота или секрета. */
export function telegramSetup(tenant: AdventTenant): TelegramSetup | null {
  const telegram = tenant.platforms.telegram;
  if (!telegram) return null;
  const botToken = telegramBotToken(telegram.botUsername);
  const secret = platformIdSecret();
  if (!botToken || !secret) return null;
  return { botToken, secret, maxAgeSeconds: getRuntimeEnv().TELEGRAM_INIT_DATA_MAX_AGE };
}
