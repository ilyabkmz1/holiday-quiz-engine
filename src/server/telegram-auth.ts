import { DomainError } from "@/domain/errors";
import { parseStartParam, type StartParam } from "@/platform/start-param";
import { TelegramInitDataError, verifyTelegramInitData } from "@/platform/telegram-init-data";
import { getNow } from "@/server/container";
import { INIT_DATA_HEADER, subjectHash, telegramSetup } from "@/server/telegram-config";
import type { AdventTenant } from "@/server/tenants";

type HeaderReader = { get(name: string): string | null };

export type TelegramCaller = { subjectHash: string; start: StartParam };

const REJECTED = "Не удалось подтвердить вход через Telegram. Закройте приложение и откройте его снова.";

/**
 * Пользователь Telegram из заголовка запроса. `null` — заголовка нет (обычный веб, работает cookie). Заголовок есть, но
 * Telegram у арендатора выключен или не настроен, подпись неверна либо срок истёк — 401 (`unauthorized`), без отката на cookie:
 * иначе подделанный заголовок молча превращался бы в анонимного веб-участника. Причина отказа в ответ и логи не попадает.
 */
export function telegramCaller(headers: HeaderReader, tenant: AdventTenant): TelegramCaller | null {
  const initData = headers.get(INIT_DATA_HEADER);
  if (initData === null) return null;
  const setup = telegramSetup(tenant);
  if (!setup) throw new DomainError("unauthorized", REJECTED);
  try {
    const verified = verifyTelegramInitData(initData, setup.botToken, getNow(), setup.maxAgeSeconds);
    return {
      subjectHash: subjectHash("telegram", tenant.advent.slug, verified.userId, setup.secret),
      start: parseStartParam(verified.startParam)
    };
  } catch (error) {
    if (error instanceof TelegramInitDataError) throw new DomainError("unauthorized", REJECTED);
    throw error;
  }
}
