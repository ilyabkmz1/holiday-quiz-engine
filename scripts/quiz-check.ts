// Проверка пакета арендатора: `npm run quiz:check -- <slug>` (или `--all`).
// Схема, незаполненные места (TODO), семантический линт, контраст, симуляция идеального и нулевого прохода.
// Код возврата 1 при ошибках. Предупреждения не блокируют, но их нужно прочитать.
// Адвент: `--participants N` — ожидаемое число участников для проверки запаса кодов (важнее поля пакета expectedParticipants).
import { checkPack } from "../src/tools/pack-check";
import { loadPacks, packSlug, projectRoot } from "./lib/packs";

const args = process.argv.slice(2);
const all = args.includes("--all");
const participantsFlag = args.indexOf("--participants");
const participants = participantsFlag >= 0 ? Number(args[participantsFlag + 1]) : undefined;
const slug = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--participants");
if ((!all && !slug) || (participants !== undefined && (!Number.isInteger(participants) || participants < 1))) {
  console.error("Использование: npm run quiz:check -- <slug> | --all [--participants N]");
  process.exit(2);
}

const packs = await loadPacks();
const entries = packs.map((raw) => ({ slug: packSlug(raw), raw }));
const selected = all ? entries : entries.filter((entry) => entry.slug === slug);
if (selected.length === 0) {
  console.error(`Пакет «${slug}» не найден в tenants/index.ts. Доступны: ${entries.map((entry) => entry.slug).join(", ")}`);
  process.exit(2);
}

let failed = false;
for (const { slug: name, raw } of selected) {
  const report = await checkPack(raw, { root: projectRoot(), ...(participants !== undefined ? { expectedParticipants: participants } : {}) });
  console.log(`\n== ${name} ==`);
  for (const line of report.info) console.log(`  · ${line}`);
  for (const line of report.warnings) console.log(`  ! ${line}`);
  for (const line of report.errors) console.log(`  ✗ ${line}`);
  if (report.errors.length > 0) failed = true;
  else console.log(`  ✓ ошибок нет${report.warnings.length ? `, предупреждений: ${report.warnings.length}` : ""}`);
}
process.exit(failed ? 1 : 0);
