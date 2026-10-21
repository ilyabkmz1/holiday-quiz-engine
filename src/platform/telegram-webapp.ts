import type { PlatformKind } from "@/platform";

/** Часть `window.Telegram.WebApp`, которой пользуется игра (https://core.telegram.org/bots/webapps). */
export type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { start_param?: string };
  version?: string;
  platform?: string;
  isVersionAtLeast?: (version: string) => boolean;
  ready: () => void;
  expand: () => void;
  close?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  openTelegramLink?: (url: string) => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void };
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const TELEGRAM_SCRIPT_SRC = "https://telegram.org/js/telegram-web-app.js?64";

const SESSION_KEY = "hqe-platform";

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Открыта ли страница в Telegram: в hash есть данные запуска (`tgWebAppData`/`tgWebAppPlatform`), адрес с `?platform=telegram`,
 * скрипт Telegram уже подставил `window.Telegram.WebApp` с initData, либо так было при первой загрузке вкладки
 * (hash пропадает после навигации внутри приложения). Обычному вебу сторонний скрипт не загружается.
 */
export function detectPlatform(): PlatformKind {
  if (typeof window === "undefined") return "web";
  const fromScript = window.Telegram?.WebApp?.initData;
  const hash = window.location.hash;
  let query = "";
  try {
    query = new URLSearchParams(window.location.search).get("platform") ?? "";
  } catch {
    query = "";
  }
  const telegram = Boolean(fromScript) || /[#&]tgWebAppData=|[#&]tgWebAppPlatform=/.test(hash) || query === "telegram" || storage()?.getItem(SESSION_KEY) === "telegram";
  if (telegram) {
    try {
      storage()?.setItem(SESSION_KEY, "telegram");
    } catch {
      // Хранилище недоступно: определение повторится по hash.
    }
  }
  return telegram ? "telegram" : "web";
}

/** Загружает `telegram-web-app.js` один раз; без Telegram или при сбое сети — `null` (игра откроется как обычный веб). */
export function loadTelegramWebApp(timeoutMs = 4000): Promise<TelegramWebApp | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => resolve(window.Telegram?.WebApp ?? null), timeoutMs);
    const done = () => {
      window.clearTimeout(timer);
      resolve(window.Telegram?.WebApp ?? null);
    };
    script.src = TELEGRAM_SCRIPT_SRC;
    script.async = true;
    script.onload = done;
    script.onerror = done;
    document.head.appendChild(script);
  });
}

export type HapticKind = "tap" | "open" | "success" | "warning";

/** Что игра делает с оболочкой платформы. В обычном вебе все методы — безопасные заглушки. */
export type PlatformBridge = {
  kind: PlatformKind;
  /** Заголовок для API: `initData` текущего запуска или `null`. */
  initData: string | null;
  /** Параметр запуска (`startapp`) из данных Telegram; для навигации (доверять ему нельзя, сервер читает свой). */
  startParam: string | null;
  ready: () => void;
  expand: () => void;
  setColors: (colors: { header: string; background: string }) => void;
  /** Показывает BackButton и вызывает `onBack` по нажатию. Возвращает функцию отмены. */
  showBack: (onBack: () => void) => () => void;
  haptic: (kind: HapticKind) => void;
  openTelegramLink: (url: string) => boolean;
};

function guarded(action: () => void): void {
  try {
    action();
  } catch {
    // Старый клиент Telegram не знает метода: оболочка необязательна.
  }
}

export const WEB_BRIDGE: PlatformBridge = {
  kind: "web",
  initData: null,
  startParam: null,
  ready: () => undefined,
  expand: () => undefined,
  setColors: () => undefined,
  showBack: () => () => undefined,
  haptic: () => undefined,
  openTelegramLink: () => false
};

/** Обёртка над `Telegram.WebApp`: каждый вызов защищён от клиентов, где метода ещё нет. */
export function createTelegramBridge(app: TelegramWebApp): PlatformBridge {
  const atLeast = (version: string) => {
    try {
      return app.isVersionAtLeast ? app.isVersionAtLeast(version) : false;
    } catch {
      return false;
    }
  };
  return {
    kind: "telegram",
    initData: app.initData || null,
    startParam: app.initDataUnsafe?.start_param ?? null,
    ready: () => guarded(() => app.ready()),
    expand: () => guarded(() => app.expand()),
    setColors: ({ header, background }) =>
      guarded(() => {
        // Цвета шапки и фона — с Bot API 6.1.
        if (!atLeast("6.1")) return;
        app.setHeaderColor?.(header);
        app.setBackgroundColor?.(background);
        if (atLeast("7.10")) app.setBottomBarColor?.(background);
      }),
    showBack: (onBack) => {
      const back = app.BackButton;
      if (!back || !atLeast("6.1")) return () => undefined;
      guarded(() => {
        back.onClick(onBack);
        back.show();
      });
      return () =>
        guarded(() => {
          back.offClick(onBack);
          back.hide();
        });
    },
    haptic: (kind) =>
      guarded(() => {
        const haptics = app.HapticFeedback;
        if (!haptics || !atLeast("6.1")) return;
        if (kind === "tap") haptics.selectionChanged();
        else if (kind === "open") haptics.impactOccurred("medium");
        else if (kind === "success") haptics.notificationOccurred("success");
        else haptics.notificationOccurred("warning");
      }),
    openTelegramLink: (url) => {
      if (!app.openTelegramLink) return false;
      try {
        app.openTelegramLink(url);
        return true;
      } catch {
        return false;
      }
    }
  };
}
