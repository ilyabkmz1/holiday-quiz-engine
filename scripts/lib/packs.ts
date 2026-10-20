import path from "node:path";
import { pathToFileURL } from "node:url";

/** Корень проекта для CLI: текущий каталог (`npm run` запускает из корня). Тесты CLI запускают скрипты во временном каталоге. */
export const projectRoot = (): string => process.cwd();

/** Манифест пакетов `tenants/index.ts` корня проекта (динамически: корень задаёт каталог запуска, а не расположение скрипта). */
export async function loadPacks(root = projectRoot()): Promise<unknown[]> {
  const manifest = (await import(pathToFileURL(path.join(root, "tenants", "index.ts")).href)) as { packs: unknown[] };
  return manifest.packs;
}

export function packSlug(raw: unknown): string {
  return (raw as { tenant?: string }).tenant ?? "?";
}
