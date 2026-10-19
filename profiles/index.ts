import b2b from "./b2b.json" with { type: "json" };
import beauty from "./beauty.json" with { type: "json" };
import corporate from "./corporate.json" with { type: "json" };
import horeca from "./horeca.json" with { type: "json" };
import retail from "./retail.json" with { type: "json" };

/**
 * Манифест профилей бизнеса (статический, как `worlds/index.ts`). Каждый профиль проверяет `adventProfileSchema`
 * (src/config/advent-profile.ts). В рантайме профили не участвуют: из них `quiz:new` собирает черновик адвент-пакета.
 */
export const rawProfiles: Record<string, unknown> = {
  retail,
  horeca,
  beauty,
  b2b,
  corporate
};
