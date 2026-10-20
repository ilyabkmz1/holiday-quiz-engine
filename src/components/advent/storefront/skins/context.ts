import { createContext, useContext } from "react";

import type { AdventCopy } from "@/config/advent-schema";
import type { Facade } from "@/config/facade";

export type SkinContextValue = { copy: AdventCopy; vessel: Facade["vessel"] };

/** Тексты и ёмкость для обложек заданий: обложка — обычный компонент механики, поэтому всё нужное ей приходит через контекст. */
export const StorefrontSkinContext = createContext<SkinContextValue | null>(null);

export function useSkin(): SkinContextValue {
  const value = useContext(StorefrontSkinContext);
  if (!value) throw new Error("Обложка задания «Витрины» используется вне StorefrontSkinContext");
  return value;
}
