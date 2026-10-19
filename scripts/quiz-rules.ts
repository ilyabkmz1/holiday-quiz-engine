// Правила акции адвента из пакета: `npm run quiz:rules -- <slug> [--force]` пишет tenants/<slug>/rules.md.
// Это черновик для юриста заказчика (организатор, сроки, порядок участия, призы, сроки кодов, персональные данные);
// в начале стоит пометка «требует утверждения». Существующий rules.md не перезаписывается без --force: юрист мог его править.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { adventPackSchema, TENANT_SLUG_PATTERN } from "../src/config/pack";
import { buildRules } from "../src/tools/advent-rules";
import { MARKER, walkStrings } from "../src/tools/pack-walk";
import { loadPacks, packSlug, projectRoot } from "./lib/packs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const slug = args.find((arg) => !arg.startsWith("--"));
if (!slug || !TENANT_SLUG_PATTERN.test(slug)) {
  console.error("Использование: npm run quiz:rules -- <slug> [--force]\nslug: латиница, цифры и дефис, 2–41 символ.");
  process.exit(2);
}

const packs = await loadPacks();
const raw = packs.find((item) => packSlug(item) === slug);
if (!raw) {
  console.error(`Пакет «${slug}» не найден в tenants/index.ts. Доступны: ${packs.map(packSlug).join(", ")}`);
  process.exit(2);
}
if ((raw as { experience?: string }).experience !== "advent") {
  console.error(`Пакет «${slug}» — не адвент: правила акции собираются только для адвента.`);
  process.exit(2);
}
const parsed = adventPackSchema.safeParse(raw, { error: z.locales.ru().localeError });
if (!parsed.success) {
  for (const issue of parsed.error.issues) console.error(`схема: ${issue.path.join(".") || "(корень)"}: ${issue.message}`);
  process.exit(1);
}

const file = path.join(projectRoot(), "tenants", slug, "rules.md");
if (existsSync(file) && !force) {
  console.error(`tenants/${slug}/rules.md уже существует: он мог быть доработан юристом. Перезапись — с флагом --force.`);
  process.exit(1);
}
writeFileSync(file, buildRules(parsed.data));
console.log(`Записан tenants/${slug}/rules.md. Отправьте его юристу заказчика: файл требует утверждения.`);

const markers: string[] = [];
walkStrings(raw, "", (where, text) => {
  if (MARKER.test(text)) markers.push(where);
});
if (markers.length > 0) console.warn(`Внимание: в пакете ещё ${markers.length} незаполненных мест (TODO), они попали в правила. Заполните пакет и пересоберите файл с --force.`);
