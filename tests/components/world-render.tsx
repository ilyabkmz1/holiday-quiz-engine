import { render, type RenderOptions } from "@testing-library/react";
import type { ReactNode } from "react";

import { WorldProvider } from "@/components/play/world-context";
import { snowGlobe, snowGlobeRooms } from "../support/world";

/** `render` с миром snow-globe: компонентам карточек и квеста мир приходит из контекста (в игре его кладёт `QuizGame`/`QuestGame`). */
export function renderInWorld(ui: ReactNode, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { ...options, wrapper: ({ children }) => <WorldProvider world={snowGlobe} rooms={snowGlobeRooms}>{children}</WorldProvider> });
}
