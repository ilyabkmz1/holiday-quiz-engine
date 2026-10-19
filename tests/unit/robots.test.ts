import { afterEach, describe, expect, it, vi } from "vitest";

import { robotsRules } from "@/server/robots";

const staging = { STAGING_USERNAME: "preview", STAGING_PASSWORD: "staging-password-16+chars" };

describe("robotsRules", () => {
  it("production: открывает главную и /share/, закрывает служебные пути и остальное", () => {
    const { rules } = robotsRules({});
    expect(rules).toEqual({
      userAgent: "*",
      allow: ["/$", "/share/"],
      disallow: ["/admin", "/api", "/verify", "/quest", "/"]
    });
  });

  it("staging: закрывает всё", () => {
    expect(robotsRules(staging).rules).toEqual({ userAgent: "*", disallow: "/" });
  });

  it("половина staging-креденшелов не закрывает сайт", () => {
    expect(robotsRules({ STAGING_USERNAME: "preview" }).rules).toMatchObject({ allow: ["/$", "/share/"] });
  });
});

describe("app/robots.ts", () => {
  const env = {
    DATABASE_URL: "postgresql://quiz:quiz@127.0.0.1:5432/quiz",
    APP_URL: "https://quiz.example.com",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_FROM: "quiz@example.test",
    ADMIN_USERNAME: "operator",
    ADMIN_PASSWORD: "local-password-at-least-16"
  };

  afterEach(() => vi.unstubAllEnvs());

  async function renderRobots(extra: Record<string, string>) {
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries({ ...env, NODE_ENV: "production", ...extra })) vi.stubEnv(key, value);
    return (await import("@/app/robots")).default();
  }

  it("в production отдаёт открытые / и /share/", async () => {
    expect((await renderRobots({})).rules).toMatchObject({ allow: ["/$", "/share/"], disallow: expect.arrayContaining(["/admin", "/api", "/verify", "/quest"]) });
  });

  it("в staging отдаёт Disallow: /", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect((await renderRobots(staging)).rules).toEqual({ userAgent: "*", disallow: "/" });
    } finally {
      warn.mockRestore();
    }
  });
});
