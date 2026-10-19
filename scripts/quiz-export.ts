// `npm run quiz:export -- <slug> [--domain D] [--email E] [--smtp-from F] [--out каталог] [--build] [--force]`
// Папка для сервера клиента (однопользовательский режим TENANT=<slug>): `.env` с настоящими секретами (через deploy/generate-secrets.sh,
// права 600, в вывод не печатаются), инструкция выкатки и, с --build, образы app и migrate только с пакетом клиента (нужен Docker).
// В боевой образ клиента демо и чужие пакеты не попадают: QUIZ_PACKS=<slug>.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TENANT_SLUG_PATTERN } from "../src/config/pack";
import { exportEnv, exportReadme, exportSteps, isDomain, setEnvLines } from "../src/tools/hosting";
import { checkPack } from "../src/tools/pack-check";
import { packs } from "../tenants/index";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const slug = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const USAGE = "Использование: npm run quiz:export -- <slug> [--domain quiz.client.ru] [--email ops@client.ru] [--smtp-from 'Имя <a@b>'] [--out каталог] [--build] [--force]";

if (!slug || !TENANT_SLUG_PATTERN.test(slug)) {
  console.error(USAGE);
  process.exit(2);
}
const raw = (packs as Array<{ tenant?: string }>).find((item) => item.tenant === slug);
if (!raw) {
  console.error(`Пакет «${slug}» не найден в tenants/index.ts`);
  process.exit(2);
}
const domain = flag("domain");
if (domain && !isDomain(domain)) {
  console.error(`Некорректный домен «${domain}» (ожидается вроде quiz.client.ru, без https:// и пути).`);
  process.exit(2);
}

const report = await checkPack(raw);
for (const line of report.warnings) console.warn(`[предупреждение] ${line}`);
if (report.errors.length > 0) {
  for (const line of report.errors) console.error(`[ошибка] ${line}`);
  console.error(`Экспорт невозможен: ошибок в пакете — ${report.errors.length}. Сначала: npm run quiz:check -- ${slug}`);
  process.exit(1);
}

const outDir = path.resolve(flag("out") ?? path.join("exports", slug));
if (existsSync(path.join(outDir, ".env")) && !has("force")) {
  console.error(`${outDir}/.env уже существует: секреты не перезаписываются. Для замены — --force (старый файл сохранится как .env.bak-…).`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true, mode: 0o700 });

let version = "dev";
const rev = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
if (rev.status === 0) version = rev.stdout.trim() || version;

const steps = exportSteps({ slug, outDir, domain, email: flag("email"), smtpFrom: flag("smtp-from"), build: has("build"), version });
for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.title}`);
  const result = spawnSync(step.command, step.args, { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...step.env } });
  if (result.error) {
    console.error(`Не удалось запустить ${step.command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (index === 0) {
    const envPath = path.join(outDir, ".env");
    writeFileSync(envPath, setEnvLines(readFileSync(envPath, "utf8"), exportEnv(slug)));
    chmodSync(envPath, 0o600);
  }
}

writeFileSync(path.join(outDir, "README.md"), exportReadme(slug, { domain, built: has("build") }));
console.log(`\nГотово: ${outDir}`);
console.log("  .env      — секреты и окружение клиента (права 600; не коммитить, не пересылать в чат)");
console.log("  README.md — выкатка на сервер клиента");
if (has("build")) console.log(`  quiz-${slug}-images.tar.gz — образы app и migrate`);
