import { rawWorlds } from "@worlds/index";

import { parseWorld, type World } from "@/worlds/world";

const cache = new Map<string, World>();
let extra: Record<string, unknown> = {};

/** Только для тестов: добавляет миры-фикстуры к манифесту (`null` убирает). */
export function overrideWorlds(next: Record<string, unknown> | null): void {
  extra = next ?? {};
  cache.clear();
}

const manifest = (): Record<string, unknown> => ({ ...rawWorlds, ...extra });

export function worldIds(): string[] {
  return Object.keys(manifest());
}

/** Мир по id: проверяется при первой загрузке (схема, ссылки, связность графа). */
export function loadWorld(id: string): World {
  const cached = cache.get(id);
  if (cached) return cached;
  const raw = manifest()[id];
  if (!raw) throw new Error(`Мир «${id}» не найден. Доступны: ${worldIds().join(", ")}`);
  const world = parseWorld(raw);
  cache.set(id, world);
  return world;
}
