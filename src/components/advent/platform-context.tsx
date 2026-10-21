"use client";

import { createContext, useContext } from "react";

import { WEB_BRIDGE, type PlatformBridge } from "@/platform/telegram-webapp";

const PlatformContext = createContext<PlatformBridge>(WEB_BRIDGE);

/** Оболочка платформы (Telegram) для вложенных экранов: тактильный отклик и пр. Без провайдера — заглушки обычного веба. */
export const PlatformProvider = PlatformContext.Provider;

export function usePlatformBridge(): PlatformBridge {
  return useContext(PlatformContext);
}
