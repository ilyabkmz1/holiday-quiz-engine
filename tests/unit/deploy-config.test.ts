import { readFileSync } from "node:fs";

import { parse } from "dotenv";
import { describe, expect, it } from "vitest";

import { isForceOpenAllowed } from "@/server/env";

/** Разбирает шаблон .env как Compose: ${VAR} подставляется из ранее заданных значений, CHANGE_ME_* заменяются. */
function load(name: string): Record<string, string> {
  const raw = parse(readFileSync(new URL(`../../deploy/${name}`, import.meta.url)));
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[key] = value
      .replace(/\$\{(\w+)\}/g, (_, ref: string) => result[ref] ?? "")
      .replace(/CHANGE_ME_\w+/, "x".repeat(32));
  }
  return result;
}

describe("deploy/.env.*.example", () => {
  it("APP_URL в шаблонах литерал: скрипты читают .env без подстановки ${DOMAIN}", () => {
    for (const name of [".env.staging.example", ".env.production.example"]) {
      const line = readFileSync(new URL(`../../deploy/${name}`, import.meta.url), "utf8")
        .split("\n")
        .find((l) => l.startsWith("APP_URL="));
      expect(line, name).toBe("APP_URL=https://quiz.example.com");
    }
  });

  it("staging: Basic auth + force-open, Mailpit, публичный APP_URL допускается приложением", () => {
    const env = load(".env.staging.example");
    expect(env.COMPOSE_PROFILES).toBe("staging");
    expect(env.SMTP_HOST).toBe("mailpit");
    expect(env.APP_URL).toBe(`https://${env.DOMAIN}`);
    expect(env.DATABASE_URL).toContain("@db:5432/");
    expect(env.STAGING_PASSWORD.length).toBeGreaterThanOrEqual(16);
    expect(
      isForceOpenAllowed({
        NODE_ENV: "production",
        APP_URL: env.APP_URL,
        QUIZ_FORCE_OPEN: env.QUIZ_FORCE_OPEN === "true",
        QUIZ_LOCAL_STACK: false,
        STAGING_USERNAME: env.STAGING_USERNAME,
        STAGING_PASSWORD: env.STAGING_PASSWORD
      })
    ).toBe(true);
  });

  it("production: без Basic auth, без force-open, без Mailpit", () => {
    const env = load(".env.production.example");
    expect(env.COMPOSE_PROFILES).toBe("");
    expect(env.STAGING_USERNAME).toBeUndefined();
    expect(env.STAGING_PASSWORD).toBeUndefined();
    expect(env.QUIZ_FORCE_OPEN).toBe("false");
    expect(env.SMTP_HOST).not.toBe("mailpit");
    expect(env.APP_URL).toBe(`https://${env.DOMAIN}`);
  });

  it("оба шаблона задают все переменные, нужные compose.yml", () => {
    for (const name of [".env.staging.example", ".env.production.example"]) {
      const env = load(name);
      for (const key of [
        "DOMAIN", "ACME_EMAIL", "APP_URL", "POSTGRES_PASSWORD", "DATABASE_URL", "SMTP_HOST", "SMTP_PORT",
        "SMTP_FROM", "ADMIN_USERNAME", "ADMIN_PASSWORD", "QUIZ_FORCE_OPEN"
      ]) {
        expect(env[key], `${name}: ${key}`).toBeTruthy();
      }
    }
  });
});

describe("версия сборки", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

  it("Dockerfile: ARG/ENV APP_VERSION стоят после COPY, чтобы не сбрасывать кеш слоёв", () => {
    const runner = read("Dockerfile").split("AS runner")[1];
    expect(runner.lastIndexOf("COPY")).toBeLessThan(runner.indexOf("ARG APP_VERSION"));
    expect(runner).toContain("ENV APP_VERSION=$APP_VERSION");
  });

  it("compose, боевой compose, deploy.sh и CI передают APP_VERSION в сборку", () => {
    expect(read("docker-compose.yml")).toContain("APP_VERSION: ${APP_VERSION:-dev}");
    expect(read("deploy/compose.yml")).toContain("APP_VERSION: ${APP_VERSION:-dev}");
    expect(read("deploy/deploy.sh")).toContain('export APP_VERSION="$short"');
    expect(read(".github/workflows/ci.yml")).toContain('APP_VERSION="$(git rev-parse --short HEAD)"');
  });
});
