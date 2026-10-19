import snowGlobe from "./snow-globe/world.json" with { type: "json" };

/**
 * Манифест миров, собранных в образ (статический: бандлер должен видеть импорты). Каждый мир проверяет
 * `parseWorld` (src/worlds/world.ts). Новый мир — папка `worlds/<id>/world.json` и строка здесь.
 */
export const rawWorlds: Record<string, unknown> = {
  "snow-globe": snowGlobe
};
