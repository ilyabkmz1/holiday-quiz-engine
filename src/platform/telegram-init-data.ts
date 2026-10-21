import { createHmac, timingSafeEqual } from "node:crypto";

import { START_PARAM_PATTERN } from "@/platform/start-param";

/** Серверная проверка initData мини-приложения Telegram (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). */
export type TelegramInitData = {
  /** Числовой идентификатор пользователя Telegram. Дальше сервера в сыром виде не идёт: хранится только HMAC. */
  userId: string;
  startParam: string | null;
  authDate: Date;
};

export type InitDataFailure = "malformed" | "bad_signature" | "expired" | "future" | "no_user";

export class TelegramInitDataError extends Error {
  constructor(readonly reason: InitDataFailure) {
    super(`initData отклонён: ${reason}`);
    this.name = "TelegramInitDataError";
  }
}

/** Запас на расхождение часов сервера и Telegram. */
const FUTURE_SKEW_SECONDS = 60;
const MAX_LENGTH = 16 * 1024;
const HEX64 = /^[0-9a-f]{64}$/i;

function hmac(key: string | Buffer, message: string): Buffer {
  return createHmac("sha256", key).update(message).digest();
}

/**
 * Проверяет подпись и срок initData. В `data_check_string` входят все поля, кроме `hash` (в том числе `signature`,
 * подпись Ed25519 для третьих сторон: для HMAC-проверки она обычное поле), по ключу, в виде `key=value` через `\n`.
 * Ключ `secret_key = HMAC_SHA256("WebAppData", токен бота)`. Сравнение хеша за постоянное время.
 * Бросает `TelegramInitDataError` с причиной; токен и initData в сообщение не попадают.
 */
export function verifyTelegramInitData(initData: string, botToken: string, now: Date, maxAgeSeconds: number): TelegramInitData {
  if (typeof initData !== "string" || initData.length === 0 || initData.length > MAX_LENGTH || botToken.length === 0) {
    throw new TelegramInitDataError("malformed");
  }
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  // Повтор ключа неоднозначен: подпись считается по одному значению, а приложение могло бы прочитать другое.
  if (new Set(keys).size !== keys.length) throw new TelegramInitDataError("malformed");
  const hash = params.get("hash");
  if (!hash || !HEX64.test(hash)) throw new TelegramInitDataError("malformed");

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const expected = hmac(hmac("WebAppData", botToken), dataCheckString);
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) throw new TelegramInitDataError("bad_signature");

  // Подпись верна: поля подписаны Telegram. Разбор ниже защищается от неожиданной формы, а не от подделки.
  const authSeconds = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authSeconds) || authSeconds <= 0) throw new TelegramInitDataError("malformed");
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (authSeconds - nowSeconds > FUTURE_SKEW_SECONDS) throw new TelegramInitDataError("future");
  if (nowSeconds - authSeconds > maxAgeSeconds) throw new TelegramInitDataError("expired");

  let userId: string | null = null;
  try {
    const user: unknown = JSON.parse(params.get("user") ?? "null");
    const id = user && typeof user === "object" ? (user as { id?: unknown }).id : undefined;
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) userId = String(id);
  } catch {
    userId = null;
  }
  if (userId === null) throw new TelegramInitDataError("no_user");

  const start = params.get("start_param");
  return {
    userId,
    startParam: start !== null && START_PARAM_PATTERN.test(start) ? start : null,
    authDate: new Date(authSeconds * 1000)
  };
}

/** Подписывает initData для тестов и разработки (то же, что делает Telegram). Токен — только тестовый. */
export function signTelegramInitData(fields: Record<string, string>, botToken: string): string {
  const entries = Object.entries(fields).filter(([key]) => key !== "hash");
  const dataCheckString = entries
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const hash = hmac(hmac("WebAppData", botToken), dataCheckString).toString("hex");
  const params = new URLSearchParams(entries);
  params.set("hash", hash);
  return params.toString();
}
