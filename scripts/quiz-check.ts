// Проверка пакета арендатора: `npm run quiz:check -- <slug>` (или `--all`).
// Схема, незаполненные места (TODO), семантический линт, контраст, симуляция идеального и нулевого прохода.
// Код возврата 1 при ошибках. Предупреждения не блокируют, но их нужно прочитать.
import { checkPack } from "../src/tools/pack-check";
import { packs } from "../tenants/index";

const args = process.argv.slice(2);
const all = args.includes("--all");
const slug = args.find((arg) => !arg.startsWith("--"));
if (!all && !slug) {
  console.error("Использование: npm run quiz:check -- <slug> | --all");
  process.exit(2);
}

const entries = (packs as Array<{ tenant?: string }>).map((raw) => ({ slug: raw.tenant ?? "?", raw }));
const selected = all ? entries : entries.filter((entry) => entry.slug === slug);
if (selected.length === 0) {
  console.error(`Пакет «${slug}» не найден в tenants/index.ts. Доступны: ${entries.map((entry) => entry.slug).join(", ")}`);
  process.exit(2);
}

let failed = false;
for (const { slug: name, raw } of selected) {
  const report = await checkPack(raw);
  console.log(`\n== ${name} ==`);
  for (const line of report.info) console.log(`  · ${line}`);
  for (const line of report.warnings) console.log(`  ! ${line}`);
  for (const line of report.errors) console.log(`  ✗ ${line}`);
  if (report.errors.length > 0) failed = true;
  else console.log(`  ✓ ошибок нет${report.warnings.length ? `, предупреждений: ${report.warnings.length}` : ""}`);
}
process.exit(failed ? 1 : 0);
