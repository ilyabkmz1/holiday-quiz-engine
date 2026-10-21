import type { Page } from "@playwright/test";

import { signTelegramInitData } from "../../../src/platform/telegram-init-data";

/** Тестовый токен бота: сервер e2e получает его из `playwright.advent.config.ts`. Это не секрет, а значение одноразового прогона. */
export const E2E_TELEGRAM_BOT_TOKEN = "123456789:e2e-only-bot-token-0123456789abcdef";

/** Настоящий подписанный initData (время — реальное: сервер проверяет `auth_date` по своим часам, а `?asOf=` двигает только игровое время). */
export function e2eInitData(userId: number, startParam?: string): string {
  return signTelegramInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: `AAE2E${userId}`,
      user: JSON.stringify({ id: userId, first_name: "Тест", username: `e2e_user_${userId}`, language_code: "ru" }),
      ...(startParam ? { start_param: startParam } : {})
    },
    E2E_TELEGRAM_BOT_TOKEN
  );
}

export type FakeTelegramLog = { calls: string[]; haptics: string[]; colors: Array<[string, string]>; links: string[]; backClick: (() => void) | null };

/**
 * Подменяет `window.Telegram.WebApp` фейком с настоящим подписанным initData. Скрипт telegram.org не загружается:
 * запросы к нему блокируются и запоминаются, тест убеждается, что их не было. Журнал вызовов — в `window.__tg`.
 */
export async function installFakeTelegram(page: Page, initData: string, startParam?: string): Promise<{ externalRequests: string[] }> {
  const externalRequests: string[] = [];
  await page.route(/^https?:\/\/(?:[^/]*\.)?telegram\.org\//, async (route) => {
    externalRequests.push(route.request().url());
    await route.abort();
  });
  await page.addInitScript(
    ({ data, start }) => {
      const log = { calls: [] as string[], haptics: [] as string[], colors: [] as Array<[string, string]>, links: [] as string[], backClick: null as null | (() => void) };
      (window as unknown as { __tg: typeof log }).__tg = log;
      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          initData: data,
          initDataUnsafe: { start_param: start },
          version: "8.0",
          platform: "android",
          isVersionAtLeast: () => true,
          ready: () => log.calls.push("ready"),
          expand: () => log.calls.push("expand"),
          setHeaderColor: (color: string) => log.colors.push(["header", color]),
          setBackgroundColor: (color: string) => log.colors.push(["background", color]),
          setBottomBarColor: (color: string) => log.colors.push(["bottom", color]),
          openTelegramLink: (url: string) => log.links.push(url),
          BackButton: {
            show: () => log.calls.push("back:show"),
            hide: () => log.calls.push("back:hide"),
            onClick: (callback: () => void) => {
              log.backClick = callback;
            },
            offClick: () => {
              log.backClick = null;
            }
          },
          HapticFeedback: {
            impactOccurred: (style: string) => log.haptics.push(`impact:${style}`),
            notificationOccurred: (type: string) => log.haptics.push(`notification:${type}`),
            selectionChanged: () => log.haptics.push("selection")
          }
        }
      };
      // Отступы safe area и шапки Telegram приходят CSS-переменными; фейк задаёт типичные для телефона.
      const style = document.createElement("style");
      style.textContent = ":root{--tg-safe-area-inset-top:0px;--tg-content-safe-area-inset-top:56px;--tg-safe-area-inset-bottom:0px}";
      document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
    },
    { data: initData, start: startParam }
  );
  return { externalRequests };
}

export const tgLog = (page: Page): Promise<FakeTelegramLog> =>
  page.evaluate(() => {
    const log = (window as unknown as { __tg: FakeTelegramLog }).__tg;
    return { ...log, backClick: null };
  });
