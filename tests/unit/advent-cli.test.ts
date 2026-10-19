import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { adventPackSchema } from "@/config/pack";

const repo = process.cwd();
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Пустой проект: манифест с маркерами и `public/art/og-hero.jpg` (его проверяет `quiz:check`). Скрипты берут корень из cwd. */
function project(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "advent-cli-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "tenants"), { recursive: true });
  mkdirSync(path.join(dir, "public", "art"), { recursive: true });
  writeFileSync(path.join(dir, "public", "art", "og-hero.jpg"), "");
  writeFileSync(path.join(dir, "tenants", "index.ts"), 'export const packs: unknown[] = [\n  // quiz:new-append\n];\n// quiz:new-import\n');
  return dir;
}

const run = (cwd: string, script: string, ...args: string[]) =>
  spawnSync("npx", ["tsx", path.join(repo, "scripts", `${script}.ts`), ...args], {
    cwd,
    encoding: "utf8",
    timeout: 110_000,
    env: { ...process.env, TSX_TSCONFIG_PATH: path.join(repo, "tsconfig.json") }
  });

describe("quiz:new --experience advent", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = project();
  });

  it("создаёт каркас пакета, регистрирует его в манифесте и подсказывает следующий шаг", () => {
    const result = run(cwd, "quiz-new", "acme-advent", "--experience", "advent", "--days", "12", "--profile", "horeca");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("адвент: 12 дн., профиль horeca");
    expect(result.stdout).toContain("npm run quiz:check -- acme-advent");
    const pack = JSON.parse(readFileSync(path.join(cwd, "tenants", "acme-advent", "pack.json"), "utf8"));
    expect(adventPackSchema.safeParse(pack).success).toBe(true);
    expect(pack).toMatchObject({ experience: "advent", tenant: "acme-advent", profile: "horeca", demo: false });
    expect(pack.advent.days).toHaveLength(12);
    expect(existsSync(path.join(cwd, "tenants", "acme-advent", "assets", ".gitkeep"))).toBe(true);
    const manifest = readFileSync(path.join(cwd, "tenants", "index.ts"), "utf8");
    expect(manifest).toContain('import acmeAdvent from "./acme-advent/pack.json" with { type: "json" };');
    expect(manifest).toMatch(/acmeAdvent,\n\s+\/\/ quiz:new-append/);
  }, 120_000);

  it("бриф переносится, копия брифа кладётся в пакет, флаги важнее брифа", () => {
    const brief = path.join(cwd, "brief.md");
    writeFileSync(brief, "- Название бизнеса: Кофейня «Зерно»\n- Тип бизнеса: retail\n- Количество дней: 7\n- Первый день: 15.12.2026\n- Заморозки серии: 2\n- Ожидаемое число участников: 300\n");
    const result = run(cwd, "quiz-new", "zerno", "--experience", "advent", "--profile", "horeca", "--brief", brief);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Из брифа перенесено:");
    const pack = JSON.parse(readFileSync(path.join(cwd, "tenants", "zerno", "pack.json"), "utf8"));
    expect(pack.profile).toBe("horeca");
    expect(pack.advent.schedule).toMatchObject({ days: 7, startDate: "2026-12-15" });
    expect(pack.advent.streak.freezes).toBe(2);
    expect(pack.advent.brand.name).toBe("Кофейня «Зерно»");
    expect(pack.expectedParticipants).toBe(300);
    expect(readFileSync(path.join(cwd, "tenants", "zerno", "brief.md"), "utf8")).toContain("Кофейня «Зерно»");
  }, 120_000);

  it("тип бизнеса из брифа заменяет флаг --profile, если флага нет", () => {
    const brief = path.join(cwd, "brief.md");
    writeFileSync(brief, "- Тип бизнеса: b2b\n");
    expect(run(cwd, "quiz-new", "saas", "--experience", "advent", "--brief", brief).status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(cwd, "tenants", "saas", "pack.json"), "utf8")).profile).toBe("b2b");
  }, 120_000);

  it("недопустимые значения — код 2 и понятное сообщение, файлы не создаются", () => {
    const cases: Array<[string[], RegExp]> = [
      [["--experience", "advent", "--days", "4", "--profile", "horeca"], /Число дней/],
      [["--experience", "advent", "--days", "32", "--profile", "horeca"], /Число дней/],
      [["--experience", "advent", "--days", "12", "--profile", "restaurant"], /--profile/],
      [["--experience", "advent", "--days", "12"], /--profile/],
      [["--experience", "advent", "--days", "12", "--profile", "horeca", "--start", "20.12.2026"], /--start/],
      [["--experience", "game"], /--experience/]
    ];
    for (const [flags, message] of cases) {
      const result = run(cwd, "quiz-new", "bad-case", ...flags);
      expect(result.status, flags.join(" ")).toBe(2);
      expect(result.stderr).toMatch(message);
      expect(existsSync(path.join(cwd, "tenants", "bad-case"))).toBe(false);
    }
  }, 180_000);

  it("существующий пакет не перезаписывается (код 1)", () => {
    expect(run(cwd, "quiz-new", "twice", "--experience", "advent", "--days", "5", "--profile", "retail").status).toBe(0);
    const again = run(cwd, "quiz-new", "twice", "--experience", "advent", "--days", "5", "--profile", "retail");
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("уже существует");
  }, 120_000);

  it("квиз по-прежнему создаётся без флагов адвента", () => {
    const result = run(cwd, "quiz-new", "plain-quiz");
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(cwd, "tenants", "plain-quiz", "pack.json"), "utf8")).campaign.rooms).toHaveLength(3);
  }, 120_000);
});

describe("quiz:check и quiz:rules на заготовке адвента", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = project();
    const result = run(cwd, "quiz-new", "acme-advent", "--experience", "advent", "--days", "12", "--profile", "corporate");
    expect(result.status, result.stderr).toBe(0);
  }, 120_000);

  it("quiz:check не пропускает заготовку: незаполненные TODO — ошибка, код 1", () => {
    const result = run(cwd, "quiz-check", "acme-advent");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("незаполненные места (TODO/FIXME)");
    expect(result.stdout).toContain("симуляция, идеальный игрок: открыто 12 из 12");
  }, 120_000);

  it("quiz:check: --participants принимает только положительное целое; неизвестный slug — код 2", () => {
    expect(run(cwd, "quiz-check", "acme-advent", "--participants", "0").status).toBe(2);
    expect(run(cwd, "quiz-check", "acme-advent", "--participants", "abc").status).toBe(2);
    const unknown = run(cwd, "quiz-check", "no-such");
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("acme-advent");
  }, 120_000);

  it("quiz:rules пишет rules.md с пометкой об утверждении, предупреждает про TODO и не перезаписывает без --force", () => {
    const first = run(cwd, "quiz-rules", "acme-advent");
    expect(first.status, first.stderr).toBe(0);
    expect(first.stderr).toContain("незаполненных мест");
    const rules = readFileSync(path.join(cwd, "tenants", "acme-advent", "rules.md"), "utf8");
    expect(rules).toContain("ТРЕБУЕТ УТВЕРЖДЕНИЯ ЮРИСТОМ ЗАКАЗЧИКА");
    expect(rules).toContain("## 6. Персональные данные");
    writeFileSync(path.join(cwd, "tenants", "acme-advent", "rules.md"), "правки юриста");
    const again = run(cwd, "quiz-rules", "acme-advent");
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("--force");
    expect(readFileSync(path.join(cwd, "tenants", "acme-advent", "rules.md"), "utf8")).toBe("правки юриста");
    expect(run(cwd, "quiz-rules", "acme-advent", "--force").status).toBe(0);
    expect(readFileSync(path.join(cwd, "tenants", "acme-advent", "rules.md"), "utf8")).toContain("ТРЕБУЕТ УТВЕРЖДЕНИЯ");
  }, 180_000);

  it("покупка для участия: quiz:check требует rules.md, а после quiz:rules ошибка уходит и остаётся предупреждение об утверждении", () => {
    const file = path.join(cwd, "tenants", "acme-advent", "pack.json");
    const pack = JSON.parse(readFileSync(file, "utf8"));
    pack.advent.rules = { requiresPurchase: true };
    writeFileSync(file, JSON.stringify(pack));
    expect(run(cwd, "quiz-check", "acme-advent").stdout).toContain("ст. 9 38-ФЗ");
    expect(run(cwd, "quiz-rules", "acme-advent").status).toBe(0);
    const after = run(cwd, "quiz-check", "acme-advent").stdout;
    expect(after).not.toContain("ст. 9 38-ФЗ");
    expect(after).toContain("правила ещё не утверждены");
  }, 180_000);

  it("quiz:rules: не адвент и неизвестный slug — код 2", () => {
    expect(run(cwd, "quiz-new", "quiz-one").status).toBe(0);
    const notAdvent = run(cwd, "quiz-rules", "quiz-one");
    expect(notAdvent.status).toBe(2);
    expect(notAdvent.stderr).toContain("не адвент");
    expect(run(cwd, "quiz-rules", "ghost").status).toBe(2);
    expect(run(cwd, "quiz-rules", "../evil").status).toBe(2);
  }, 180_000);
});

describe("quiz:shots для адвента: разбор --day до запуска браузера", () => {
  it.each(["0", "13", "5..3", "abc", "1..99"])("--day %s — код 2 и пояснение (дней в демо-пакете 12)", (day) => {
    const result = run(repo, "quiz-shots", "demo-coffee-advent", "--day", day);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("--day");
    expect(result.stderr).toContain("1–12");
  }, 120_000);

  it("квизовый slug по-прежнему проверяется как раньше, а адвент-slug с плохим форматом — код 2", () => {
    expect(run(repo, "quiz-shots", "../evil", "--day", "1").status).toBe(2);
  }, 120_000);
});
