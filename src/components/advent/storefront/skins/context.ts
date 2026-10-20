import { createContext, useContext } from "react";

import type { AdventCopy } from "@/config/advent-schema";
import type { Facade } from "@/config/facade";

/** `cover` — обложка текущего задания из пакета; `null` — по типу задания (`order` — список, `build` — ёмкость фасада). */
export type SkinContextValue = { copy: AdventCopy; vessel: Facade["vessel"]; cover: "vessel" | "list" | null };

/** Тексты и ёмкость для обложек заданий: обложка — обычный компонент механики, поэтому всё нужное ей приходит через контекст. */
export const StorefrontSkinContext = createContext<SkinContextValue | null>(null);

export function useSkin(): SkinContextValue {
  const value = useContext(StorefrontSkinContext);
  if (!value) throw new Error("Обложка задания «Витрины» используется вне StorefrontSkinContext");
  return value;
}
