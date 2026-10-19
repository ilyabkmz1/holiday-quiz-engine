// Новый пакет арендатора:
//   квиз:   npm run quiz:new -- <slug> [--brief brief.md] [--zones 3] [--world snow-globe]
//   адвент: npm run quiz:new -- <slug> --experience advent --days 12 --profile <retail|horeca|beauty|b2b|corporate|custom> [--start 2026-12-20] [--brief brief.md]
// Создаёт tenants/<slug>/pack.json из заготовки (все тексты «TODO: …»), переносит поля брифа,
// кладёт копию брифа и регистрирует пакет в tenants/index.ts. Дальше пакет заполняет агент по скиллу build-quiz.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TENANT_SLUG_PATTERN } from "../src/config/pack";
import { ADVENT_PROFILE_CHOICES, adventChoicesFromBrief, applyAdventBrief, buildAdventTemplate } from "../src/tools/advent-template";
import { applyBrief, parseBrief } from "../src/tools/brief";
import { buildTemplate } from "../src/tools/template";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const FLAGS_WITH_VALUE = new Set(["--brief", "--zones", "--world", "--experience", "--days", "--profile", "--start"]);
const slug = args.find((arg, index) => !arg.startsWith("--") && !FLAGS_WITH_VALUE.has(args[index - 1] ?? ""));
const usage = [
  "Использование:",
  "  npm run quiz:new -- <slug> [--brief brief.md] [--zones 3] [--world snow-globe]",
  `  npm run quiz:new -- <slug> --experience advent --days 12 --profile <${ADVENT_PROFILE_CHOICES.join("|")}> [--start 2026-12-20] [--brief brief.md]`,
  "slug: латиница, цифры и дефис, 2–41 символ (например, demo-coffee)."
].join("\n");
if (!slug || !TENANT_SLUG_PATTERN.test(slug)) {
  console.error(usage);
  process.exit(2);
}
const experience = flag("experience") ?? "quiz";
if (experience !== "quiz" && experience !== "advent") {
  console.error(`--experience: quiz или advent, а не «${experience}».\n${usage}`);
  process.exit(2);
}

const root = process.cwd();
const dir = path.join(root, "tenants", slug);
if (existsSync(dir)) {
  console.error(`tenants/${slug} уже существует: пакет не перезаписывается.`);
  process.exit(1);
}

const briefPath = flag("brief");
const briefText = briefPath ? readFileSync(path.resolve(briefPath), "utf8") : null;
let applied: string[] = [];
let pack: Record<string, unknown>;
let summary: string;

if (experience === "advent") {
  const fields = briefText ? parseBrief(briefText) : {};
  const fromBrief = adventChoicesFromBrief(fields);
  // Флаги важнее брифа: бриф дописывают, а команду запускают осознанно.
  const profile = flag("profile") ?? fromBrief.profile;
  const days = flag("days") !== undefined ? Number(flag("days")) : (fromBrief.days ?? 12);
  const startDate = flag("start") ?? fromBrief.startDate;
  if (!profile || !(ADVENT_PROFILE_CHOICES as readonly string[]).includes(profile)) {
    console.error(`--profile: один из ${ADVENT_PROFILE_CHOICES.join(", ")} (или «Тип бизнеса» в брифе).\n${usage}`);
    process.exit(2);
  }
  if (startDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    console.error(`--start: дата в формате ГГГГ-ММ-ДД, а не «${startDate}».`);
    process.exit(2);
  }
  try {
    pack = buildAdventTemplate({ tenant: slug, days, profile: profile as (typeof ADVENT_PROFILE_CHOICES)[number], startDate, worldId: flag("world") });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  if (briefText) applied = applyAdventBrief(pack as never, fields);
  summary = `Создан tenants/${slug}/pack.json (адвент: ${days} дн., профиль ${profile}).`;
} else {
  pack = buildTemplate({ tenant: slug, zones: Number(flag("zones") ?? 3), worldId: flag("world") });
  if (briefText) applied = applyBrief(pack as never, parseBrief(briefText));
  summary = `Создан tenants/${slug}/pack.json (зон: ${((pack.campaign as Record<string, unknown>).rooms as unknown[]).length}).`;
}

mkdirSync(path.join(dir, "assets"), { recursive: true });
if (briefText) writeFileSync(path.join(dir, "brief.md"), briefText);
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

console.log(summary);
if (applied.length) console.log(`Из брифа перенесено: ${applied.join("; ")}`);
console.log(`Дальше: заполните все «TODO», затем npm run quiz:check -- ${slug}`);
