import cafe from "./cafe/facade.json" with { type: "json" };
import office from "./office/facade.json" with { type: "json" };
import salon from "./salon/facade.json" with { type: "json" };
import shop from "./shop/facade.json" with { type: "json" };

/**
 * Манифест фасадов адвента «Витрина» (статический: бандлер должен видеть импорты). Каждый шаблон проверяет
 * `facadeSchema` (src/config/facade.ts). Новый фасад — папка `facades/<id>/facade.json` и строка здесь.
 */
export const rawFacades: Record<string, unknown> = {
  cafe,
  shop,
  office,
  salon
};
