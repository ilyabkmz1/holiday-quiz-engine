// Прогон E2E адвента на каждом демо-пакете по очереди: `npm run test:e2e:advent` (список — E2E_TENANTS, по умолчанию оба демо).
// Сервер на каждый прогон свой: playwright.advent.config.ts поднимает его с TENANT=<slug>. Аргументы после `--` уходят в `playwright test`.
// Отчёт и трассы каждого арендатора лежат в playwright-report/advent-<slug> и test-results/advent-<slug>. Код выхода — не нулевой, если упал хоть один.
import { spawnSync } from "node:child_process";

const tenants = (process.env.E2E_TENANTS ?? "demo-coffee-advent,demo-team-advent").split(",").map((slug) => slug.trim()).filter(Boolean);
if (tenants.length === 0) {
  console.error("E2E_TENANTS пуст: не задан ни один арендатор, прогонять нечего.");
  process.exit(2);
}
const extra = process.argv.slice(2);
const failed = [];

for (const slug of tenants) {
  console.log(`\n=== E2E адвента: арендатор ${slug} ===`);
  const result = spawnSync("npx", ["playwright", "test", "--config", "playwright.advent.config.ts", `--output=test-results/advent-${slug}`, ...extra], {
    stdio: "inherit",
    env: { ...process.env, E2E_TENANT: slug, PLAYWRIGHT_HTML_REPORT: `playwright-report/advent-${slug}` }
  });
  if (result.status !== 0) failed.push(slug);
}

if (failed.length > 0) {
  console.error(`\nE2E адвента упали на арендаторах: ${failed.join(", ")}`);
  process.exit(1);
}
