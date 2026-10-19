import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { getNow } from "@/server/container";
import type { AdventTenant } from "@/server/tenants";

export const AS_OF_QUERY = "asOf";
export const AS_OF_HEADER = "x-advent-as-of";

const asOfSchema = z.iso.datetime({ offset: true });

type RequestLike = { headers: Headers; url: string };

type ResolveNowOptions = {
  /** Часы сервера; по умолчанию часы приложения (`getNow`, в тестах подменяются). */
  now?: () => Date;
  /** Режим окружения; по умолчанию `NODE_ENV`. */
  nodeEnv?: string;
};

/**
 * Время запроса для адвента. По умолчанию — часы сервера. Параметр `?asOf=<ISO 8601>` или заголовок
 * `x-advent-as-of` сдвигает время (показать клиенту день 7 сегодня, скриншоты и E2E), но только вне production
 * или для пакета с `demo: true`. В боевом режиме он игнорируется, а попытка пишется в журнал без персональных
 * данных (только арендатор и источник). Сервисы адвента получают `now` явно и сами часов не читают.
 */
export function resolveNow(request: RequestLike, tenant: AdventTenant, options: ResolveNowOptions = {}): Date {
  const serverNow = options.now ?? getNow;
  const query = new URL(request.url).searchParams.get(AS_OF_QUERY);
  const header = request.headers.get(AS_OF_HEADER);
  const requested = query ?? header;
  if (requested === null) return serverNow();

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv === "production" && !tenant.demo) {
    console.warn(JSON.stringify({ event: "advent_as_of_ignored", tenant: tenant.tenant, source: query !== null ? "query" : "header" }));
    return serverNow();
  }
  const parsed = asOfSchema.safeParse(requested);
  if (!parsed.success) throw new DomainError("invalid", "asOf: ожидается дата и время ISO 8601 со смещением, например 2026-12-26T12:00:00+03:00.");
  return new Date(parsed.data);
}
