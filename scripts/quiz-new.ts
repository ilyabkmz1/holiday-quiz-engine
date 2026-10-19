// Новый пакет арендатора: `npm run quiz:new -- <slug> [--brief brief.md] [--zones 3] [--world snow-globe]`.
// Создаёт tenants/<slug>/pack.json из заготовки (все тексты «TODO: …»), переносит поля брифа,
// кладёт копию брифа и регистрирует пакет в tenants/index.ts. Дальше пакет заполняет агент по скиллу build-quiz.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TENANT_SLUG_PATTERN } from "../src/config/pack";
import { applyBrief, parseBrief } from "../src/tools/brief";
import { buildTemplate } from "../src/tools/template";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const slug = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
if (!slug || !TENANT_SLUG_PATTERN.test(slug)) {
  console.error("Использование: npm run quiz:new -- <slug> [--brief brief.md] [--zones 3]\nslug: латиница, цифры и дефис, 2–41 символ (например, demo-coffee).");
  process.exit(2);
}

const root = process.cwd();
const dir = path.join(root, "tenants", slug);
if (existsSync(dir)) {
  console.error(`tenants/${slug} уже существует: пакет не перезаписывается.`);
  process.exit(1);
}

const pack = buildTemplate({ tenant: slug, zones: Number(flag("zones") ?? 3), worldId: flag("world") }) as { hosts: string[]; campaign: Record<string, unknown> };
let applied: string[] = [];
const briefPath = flag("brief");
if (briefPath) {
  const text = readFileSync(path.resolve(briefPath), "utf8");
  applied = applyBrief(pack as never, parseBrief(text));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "brief.md"), text);
}

mkdirSync(path.join(dir, "assets"), { recursive: true });
writeFileSync(path.join(dir, "pack.json"), `${JSON.stringify(pack, null, 2)}\n`);
writeFileSync(path.join(dir, "assets", ".gitkeep"), "");

// Регистрация в манифесте: импорт и элемент массива перед маркерами-комментариями.
const indexPath = path.join(root, "tenants", "index.ts");
let manifest = readFileSync(indexPath, "utf8");
const identifier = slug.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
if (!manifest.includes("// quiz:new-import") || !manifest.includes("// quiz:new-append")) {
  console.error("В tenants/index.ts нет маркеров «// quiz:new-import» и «// quiz:new-append»: добавьте пакет в манифест вручную.");
} else {
  manifest = manifest
    .replace("// quiz:new-import", `import ${identifier} from "./${slug}/pack.json" with { type: "json" };\n// quiz:new-import`)
    .replace("  // quiz:new-append", `  ${identifier},\n  // quiz:new-append`);
  writeFileSync(indexPath, manifest);
}

console.log(`Создан tenants/${slug}/pack.json (зон: ${(pack.campaign.rooms as unknown[]).length}).`);
if (applied.length) console.log(`Из брифа перенесено: ${applied.join("; ")}`);
console.log(`Дальше: заполните все «TODO», затем npm run quiz:check -- ${slug}`);
