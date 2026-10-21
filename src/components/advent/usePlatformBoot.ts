"use client";

import { useEffect, useState } from "react";

import { createTelegramBridge, detectPlatform, loadTelegramWebApp, WEB_BRIDGE, type PlatformBridge } from "@/platform/telegram-webapp";

export type PlatformBoot = { status: "pending" } | { status: "ready"; bridge: PlatformBridge };

/**
 * Определяет платформу и готовит оболочку. Сторонний скрипт Telegram загружается только когда страница открыта в Telegram
 * и кампания его включила; обычному вебу — никаких внешних запросов. Если скрипт не загрузился, игра открывается как обычный веб.
 */
export function usePlatformBoot(telegramEnabled: boolean): PlatformBoot {
  const [boot, setBoot] = useState<PlatformBoot>({ status: "pending" });
  useEffect(() => {
    let cancelled = false;
    const finish = (bridge: PlatformBridge) => {
      if (!cancelled) setBoot({ status: "ready", bridge });
    };
    if (!telegramEnabled || detectPlatform() !== "telegram") {
      finish(WEB_BRIDGE);
      return () => {
        cancelled = true;
      };
    }
    void loadTelegramWebApp().then((app) => finish(app && app.initData ? createTelegramBridge(app) : WEB_BRIDGE));
    return () => {
      cancelled = true;
    };
  }, [telegramEnabled]);
  return boot;
}
