// `npm run quiz:preview -- <slug> [--base-domain quiz.studio.ru] [--ssh deploy@host] [--ref origin/main] [--deploy]`
// Превью клиенту на общем сервере: пакет попадает в образ, а адрес — `https://<slug>.<общий домен>/` (wildcard DNS и on-demand TLS
// настроены один раз, см. deploy/README.md). Скрипт проверяет пакет и git-состояние, с --deploy выкатывает через deploy/deploy.sh
// по SSH и проверяет адрес. Сайт закрыт staging-паролем общего сервера: ссылку и пароль владелец передаёт клиенту сам.
import { spawnSync } from "node:child_process";

import { TENANT_SLUG_PATTERN } from "../src/config/pack";
import { isDomain, previewGitIssues, previewSteps, previewUrl } from "../src/tools/hosting";
import { checkPack } from "../src/tools/pack-check";
import { packs } from "../tenants/index";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const slug = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
const USAGE = "Использование: npm run quiz:preview -- <slug> [--base-domain quiz.studio.ru] [--ssh deploy@host] [--ref origin/main] [--deploy]\n  --base-domain по умолчанию берётся из PREVIEW_BASE_DOMAIN, --ssh — из PREVIEW_SSH.";

if (!slug || !TENANT_SLUG_PATTERN.test(slug)) {
  console.error(USAGE);
  process.exit(2);
}
const raw = (packs as Array<{ tenant?: string }>).find((item) => item.tenant === slug);
if (!raw) {
  console.error(`Пакет «${slug}» не найден в tenants/index.ts`);
  process.exit(2);
}
const baseDomain = flag("base-domain") ?? process.env.PREVIEW_BASE_DOMAIN;
if (!baseDomain || !isDomain(baseDomain)) {
  console.error(`Нужен общий домен сервера: --base-domain quiz.studio.ru или PREVIEW_BASE_DOMAIN. ${USAGE}`);
  process.exit(2);
}

const report = await checkPack(raw);
for (const line of report.warnings) console.warn(`[предупреждение] ${line}`);
if (report.errors.length > 0) {
  for (const line of report.errors) console.error(`[ошибка] ${line}`);
  console.error(`Превью не выкатывается: ошибок в пакете — ${report.errors.length}. Сначала: npm run quiz:check -- ${slug}`);
  process.exit(1);
}
console.log(`Пакет «${slug}» проходит quiz:check.`);

const git = (...gitArgs: string[]) => spawnSync("git", gitArgs, { encoding: "utf8" });
const dirty = git("status", "--porcelain", "--", `tenants/${slug}`, `public/tenants/${slug}`, "tenants/index.ts").stdout.split("\n").map((line) => line.slice(3).trim()).filter(Boolean);
const remoteBranches = git("branch", "-r", "--contains", "HEAD").stdout.split("\n").map((line) => line.trim()).filter(Boolean);
const gitIssues = previewGitIssues({ dirtyPaths: dirty, remoteBranches });

const ssh = flag("ssh") ?? process.env.PREVIEW_SSH;
const ref = flag("ref") ?? "origin/main";
const url = previewUrl({ slug, baseDomain });
const steps = previewSteps({ slug, baseDomain, ssh, ref });

if (!args.includes("--deploy")) {
  console.log(`\nАдрес превью: ${url}`);
  if (gitIssues.length > 0) for (const issue of gitIssues) console.warn(`[внимание] ${issue}`);
  console.log("\nЧтобы выкатить, закоммитьте и отправьте пакет, затем на общем сервере выполните:");
  for (const step of steps) console.log(`  ${step.command} ${step.args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`);
  console.log("или повторите эту команду с --deploy (и --ssh / PREVIEW_SSH).");
  process.exit(0);
}

if (gitIssues.length > 0) {
  for (const issue of gitIssues) console.error(`[ошибка] ${issue}`);
  process.exit(1);
}
if (!ssh) {
  console.error("Для --deploy нужен --ssh user@host или PREVIEW_SSH.");
  process.exit(2);
}
for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.title}`);
  const result = spawnSync(step.command, step.args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`Шаг «${step.title}» завершился с кодом ${result.status ?? "?"}: превью не готово. Откат — deploy/rollback.sh на сервере.`);
    process.exit(result.status ?? 1);
  }
}
const probe = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "30", url], { encoding: "utf8" });
const code = probe.stdout.trim();
// Закрытый стенд отвечает 401 без пароля: значит, сервер и сертификат на месте.
console.log(`\nПроверка ${url}: HTTP ${code || "нет ответа"}${code === "401" ? " (закрытый стенд: нужен staging-пароль)" : ""}`);
process.exit(code === "200" || code === "401" ? 0 : 1);
