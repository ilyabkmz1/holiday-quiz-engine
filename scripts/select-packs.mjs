// Сборка образа только с нужными пакетами арендаторов: `node scripts/select-packs.mjs demo-office[,другой]` (в Dockerfile — аргумент QUIZ_PACKS).
// Оставляет в tenants/index.ts только выбранные пакеты и удаляет каталоги остальных (tenants/<slug>, public/tenants/<slug>),
// чтобы демо-пакет не попал в боевой образ клиента. Запускается ТОЛЬКО на копии исходников внутри сборки образа, не в рабочем дереве.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// `import x from "./slug/pack.json" with { type: "json" }` или `import { pack as x } from "./slug/pack"`.
const IMPORT = /^import (?:(\w+)|\{ pack as (\w+) \}) from "\.\/([a-z0-9-]+)\/pack(?:\.json)?"(?: with \{ type: "json" \})?;?\s*$/;

/** Переписывает манифест: оставляет импорты и элементы массива только выбранных slug. Возвращает новый текст и список найденных slug. */
export function selectPacks(source, wanted) {
  const lines = source.split("\n");
  const variableToSlug = new Map();
  for (const line of lines) {
    const match = IMPORT.exec(line);
    if (match) variableToSlug.set(match[1] ?? match[2], match[3]);
  }
  const available = [...variableToSlug.values()];
  const missing = wanted.filter((slug) => !available.includes(slug));
  if (missing.length > 0) throw new Error(`Пакеты не найдены в tenants/index.ts: ${missing.join(", ")} (есть: ${available.join(", ")})`);
  const keep = (variable) => wanted.includes(variableToSlug.get(variable));
  const result = lines.filter((line) => {
    const imported = IMPORT.exec(line);
    if (imported) return keep(imported[1] ?? imported[2]);
    const element = /^\s*(\w+),?\s*$/.exec(line);
    // Элемент массива пакетов — идентификатор одного из импортов.
    if (element && variableToSlug.has(element[1])) return keep(element[1]);
    return true;
  });
  return { text: result.join("\n"), available };
}

function main() {
  const wanted = (process.argv[2] ?? "").split(",").map((slug) => slug.trim()).filter(Boolean);
  if (wanted.length === 0) {
    console.error("Использование: node scripts/select-packs.mjs <slug>[,<slug>…] | all");
    process.exit(2);
  }
  if (wanted.length === 1 && wanted[0] === "all") {
    console.log("QUIZ_PACKS=all: в образ входят все пакеты из tenants/");
    return;
  }
  const root = process.cwd();
  const manifest = join(root, "tenants", "index.ts");
  const { text, available } = selectPacks(readFileSync(manifest, "utf8"), wanted);
  writeFileSync(manifest, text);
  for (const slug of available.filter((candidate) => !wanted.includes(candidate))) {
    rmSync(join(root, "tenants", slug), { recursive: true, force: true });
    rmSync(join(root, "public", "tenants", slug), { recursive: true, force: true });
  }
  console.log(`В образ входят пакеты: ${wanted.join(", ")}; исключены: ${available.filter((slug) => !wanted.includes(slug)).join(", ") || "—"}`);
  if (!existsSync(join(root, "tenants", wanted[0]))) throw new Error(`Нет каталога tenants/${wanted[0]}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
