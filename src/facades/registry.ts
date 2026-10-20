import { rawFacades } from "@facades/index";

import { parseFacade, type Facade } from "@/config/facade";

const cache = new Map<string, Facade>();
let extra: Record<string, unknown> = {};

/** Только для тестов и скриншотов: добавляет фасады-фикстуры к манифесту. */
export function overrideFacades(next: Record<string, unknown> | null): void {
  extra = next ?? {};
  cache.clear();
}

const manifest = (): Record<string, unknown> => ({ ...rawFacades, ...extra });

export function facadeIds(): string[] {
  return Object.keys(manifest());
}

/** Фасад по id: проверяется при первой загрузке. */
export function loadFacade(id: string): Facade {
  const cached = cache.get(id);
  if (cached) return cached;
  const raw = manifest()[id];
  if (!raw) throw new Error(`Фасад «${id}» не найден. Доступны: ${facadeIds().join(", ")}`);
  const facade = parseFacade(raw);
  if (facade.id !== id) throw new Error(`Фасад «${id}»: id в facade.json (${facade.id}) не совпадает с папкой`);
  cache.set(id, facade);
  return facade;
}
