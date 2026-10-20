import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { exportEnv, exportReadme, exportSteps, isDomain, previewGitIssues, previewSteps, previewUrl, setEnvLines } from "@/tools/hosting";

describe("setEnvLines", () => {
  it("заменяет существующие строки и добавляет новые, остальное не трогает", () => {
    const text = "A=1\nTENANT=demo-office\nB=2\n";
    expect(setEnvLines(text, { TENANT: "demo-coffee", QUIZ_PACKS: "demo-coffee" })).toBe("A=1\nTENANT=demo-coffee\nB=2\nQUIZ_PACKS=demo-coffee\n");
    expect(setEnvLines("A=1", { B: "x=y" })).toBe("A=1\nB=x=y");
  });
});

describe("quiz:export", () => {
  it("секреты — через deploy/generate-secrets.sh в каталог экспорта, образы — только с пакетом клиента", () => {
    const steps = exportSteps({ slug: "demo-coffee", outDir: "/tmp/out", domain: "quiz.coffee.example", email: "ops@coffee.example", build: true, version: "abc123" });
    expect(steps[0]).toMatchObject({ command: "bash", env: { QUIZ_ROOT: "/tmp/out" } });
    expect(steps[0].args).toEqual(expect.arrayContaining(["deploy/generate-secrets.sh", "production", "--domain", "quiz.coffee.example", "--email", "ops@coffee.example"]));
    const builds = steps.filter((step) => step.command === "docker");
    expect(builds.map((step) => step.args[2])).toEqual(["runner", "migrate"]);
    for (const build of builds) expect(build.args.join(" ")).toContain("--build-arg QUIZ_PACKS=demo-coffee");
    expect(exportSteps({ slug: "demo-coffee", outDir: "/tmp/out" })).toHaveLength(1);
    expect(exportEnv("demo-coffee")).toEqual({ TENANT: "demo-coffee", QUIZ_PACKS: "demo-coffee" });
  });

  it("инструкция не содержит секретов и называет арендатора", () => {
    const text = exportReadme("demo-coffee", { domain: "quiz.coffee.example", built: false });
    expect(text).toContain("QUIZ_PACKS=demo-coffee");
    expect(text).toContain("quiz:admin -- demo-coffee");
    expect(text).not.toMatch(/PASSWORD=\S/);
  });

  it("isDomain отвергает схему, путь и порт", () => {
    expect(isDomain("quiz.coffee.example")).toBe(true);
    for (const value of ["https://x.ru", "x.ru/path", "x.ru:443", "localhost", "-x.ru"]) expect(isDomain(value), value).toBe(false);
  });
});

describe("quiz:preview", () => {
  it("адрес превью — поддомен общего домена; выкатка идёт через deploy/deploy.sh и deploy/smoke.sh", () => {
    expect(previewUrl({ slug: "demo-coffee", baseDomain: "quiz.studio.ru" })).toBe("https://demo-coffee.quiz.studio.ru/");
    const steps = previewSteps({ slug: "demo-coffee", baseDomain: "quiz.studio.ru", ssh: "deploy@1.2.3.4", ref: "origin/main" });
    expect(steps.map((step) => step.args.join(" "))).toEqual([
      "deploy@1.2.3.4 cd /opt/quiz/app && deploy/deploy.sh origin/main",
      "deploy@1.2.3.4 cd /opt/quiz/app && deploy/smoke.sh --local"
    ]);
  });

  it("не пускает в выкатку незакоммиченный пакет и коммит, которого нет в origin", () => {
    expect(previewGitIssues({ dirtyPaths: [], remoteBranches: ["origin/main"] })).toEqual([]);
    expect(previewGitIssues({ dirtyPaths: ["tenants/demo-coffee/pack.json"], remoteBranches: [] })).toHaveLength(2);
  });
});

describe("deploy: общий сервер", () => {
  const caddyfile = readFileSync("deploy/Caddyfile.shared", "utf8");
  const compose = readFileSync("deploy/compose.yml", "utf8");
  const dockerfile = readFileSync("Dockerfile", "utf8");

  it("Caddy: on-demand TLS спрашивает приложение, а внутренний путь снаружи закрыт", () => {
    expect(caddyfile).toMatch(/on_demand_tls\s*\{[^}]*ask http:\/\/app:3000\/api\/internal\/tls-ask\?token=\{\$TLS_ASK_TOKEN\}/);
    expect(caddyfile).toMatch(/tls\s*\{\s*on_demand\s*\}/);
    expect(caddyfile).toMatch(/@internal path \/api\/internal\/\*\s+respond @internal 404/);
    expect(caddyfile).not.toMatch(/(password|secret)\s/i);
  });

  it("Caddy: в журналы не попадают токены, код награды и подпись QR (query и Referer) — в обоих режимах", () => {
    for (const file of [caddyfile, readFileSync("deploy/Caddyfile", "utf8")]) {
      expect(file).toMatch(/request>uri query \{[^}]*delete token[^}]*delete code[^}]*\}/);
      expect(file).toContain("request>headers>Referer delete");
    }
  });

  it("compose: Caddyfile выбирается переменной, общий режим не прячется за TENANT по умолчанию, образ по умолчанию — один пакет", () => {
    expect(compose).toContain("${CADDYFILE:-./Caddyfile}:/etc/caddy/Caddyfile:ro");
    expect(compose).toContain("TENANT: ${TENANT-demo-office}");
    expect(compose.match(/QUIZ_PACKS: \$\{QUIZ_PACKS:-\$\{TENANT:-demo-office\}\}/g)).toHaveLength(2);
    expect(compose).toContain("SUPERADMIN: ${SUPERADMIN:-false}");
  });

  it("Dockerfile: пакеты фильтруются в сборке app и migrate", () => {
    expect(dockerfile.match(/node scripts\/select-packs\.mjs "\$QUIZ_PACKS"/g)).toHaveLength(2);
  });
});
