import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const base = {
  DATABASE_URL: "postgresql://quiz:quiz@127.0.0.1:5432/quiz",
  APP_URL: "http://127.0.0.1:3000",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_FROM: "quiz@example.test",
  ADMIN_USERNAME: "operator",
  ADMIN_PASSWORD: "local-password-at-least-16"
};

async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("quiz.stagingWarned")];
  for (const [key, value] of Object.entries({ ...base, ...env })) vi.stubEnv(key, value);
  return (await import("@/server/env")).getRuntimeEnv;
}

describe("getRuntimeEnv", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("разрешает QUIZ_FORCE_OPEN вне production", async () => {
    const getRuntimeEnv = await load({ NODE_ENV: "development", QUIZ_FORCE_OPEN: "true" });
    expect(getRuntimeEnv().QUIZ_FORCE_OPEN).toBe(true);
  });

  it("запрещает QUIZ_FORCE_OPEN в production", async () => {
    const getRuntimeEnv = await load({ NODE_ENV: "production", QUIZ_FORCE_OPEN: "true" });
    expect(() => getRuntimeEnv()).toThrow("QUIZ_FORCE_OPEN cannot be enabled in production");
  });

  it("маркер QUIZ_LOCAL_STACK сам по себе ничего не открывает", async () => {
    const getRuntimeEnv = await load({ NODE_ENV: "production", QUIZ_LOCAL_STACK: "true" });
    expect(getRuntimeEnv().QUIZ_FORCE_OPEN).toBe(false);
  });

  it("разрешает QUIZ_FORCE_OPEN в production с QUIZ_LOCAL_STACK и loopback APP_URL", async () => {
    for (const appUrl of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
      const getRuntimeEnv = await load({
        NODE_ENV: "production",
        APP_URL: appUrl,
        QUIZ_FORCE_OPEN: "true",
        QUIZ_LOCAL_STACK: "true"
      });
      expect(getRuntimeEnv().QUIZ_FORCE_OPEN, appUrl).toBe(true);
    }
  });

  it("запрещает QUIZ_LOCAL_STACK в production с публичным APP_URL", async () => {
    const getRuntimeEnv = await load({
      NODE_ENV: "production",
      APP_URL: "https://quiz.example.com",
      QUIZ_FORCE_OPEN: "true",
      QUIZ_LOCAL_STACK: "true"
    });
    expect(() => getRuntimeEnv()).toThrow("QUIZ_LOCAL_STACK requires a loopback APP_URL");
  });

  it("пишет одно предупреждение без секретов, когда обход включён", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const getRuntimeEnv = await load({
        NODE_ENV: "production",
        APP_URL: "http://localhost:3000",
        QUIZ_FORCE_OPEN: "true",
        QUIZ_LOCAL_STACK: "true"
      });
      getRuntimeEnv();
      getRuntimeEnv();
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = String(warn.mock.calls[0][0]);
      expect(JSON.parse(logged)).toEqual({ event: "force_open_local_stack", appHost: "localhost" });
      expect(logged).not.toContain(base.ADMIN_PASSWORD);
      expect(logged).not.toContain(base.DATABASE_URL);
    } finally {
      warn.mockRestore();
    }
  });

  it("вне production работает без предупреждения", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const getRuntimeEnv = await load({ NODE_ENV: "development", QUIZ_FORCE_OPEN: "true" });
      getRuntimeEnv();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

const stagingCreds = { STAGING_USERNAME: "preview", STAGING_PASSWORD: "staging-password-16+chars" };

describe("staging-режим", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("разрешает QUIZ_FORCE_OPEN в production с публичным APP_URL, если заданы оба staging-креденшела", async () => {
    const getRuntimeEnv = await load({
      NODE_ENV: "production",
      APP_URL: "https://quiz.example.com",
      QUIZ_FORCE_OPEN: "true",
      ...stagingCreds
    });
    expect(getRuntimeEnv().QUIZ_FORCE_OPEN).toBe(true);
  });

  it("запрещает QUIZ_FORCE_OPEN в production с публичным APP_URL без staging-креденшелов", async () => {
    for (const extra of [{}, { STAGING_USERNAME: "preview" }, { STAGING_USERNAME: "", STAGING_PASSWORD: "" }] as Record<string, string>[]) {
      const getRuntimeEnv = await load({
        NODE_ENV: "production",
        APP_URL: "https://quiz.example.com",
        QUIZ_FORCE_OPEN: "true",
        ...extra
      });
      expect(() => getRuntimeEnv(), JSON.stringify(extra)).toThrow();
    }
    const getRuntimeEnv = await load({ NODE_ENV: "production", APP_URL: "https://quiz.example.com", QUIZ_FORCE_OPEN: "true" });
    expect(() => getRuntimeEnv()).toThrow("QUIZ_FORCE_OPEN cannot be enabled in production");
  });

  it("требует задавать staging-креденшелы парой и пароль не короче 16 символов", async () => {
    await expect(load({ STAGING_USERNAME: "preview" }).then((get) => get())).rejects.toThrow();
    await expect(load({ STAGING_PASSWORD: stagingCreds.STAGING_PASSWORD }).then((get) => get())).rejects.toThrow();
    await expect(load({ STAGING_USERNAME: "preview", STAGING_PASSWORD: "short" }).then((get) => get())).rejects.toThrow();
  });

  it("пустые staging-переменные (как в Compose) означают «не задано»", async () => {
    const getRuntimeEnv = await load({ STAGING_USERNAME: "", STAGING_PASSWORD: "", SMTP_USER: "", SMTP_PASSWORD: "" });
    const env = getRuntimeEnv();
    expect(env.STAGING_USERNAME).toBeUndefined();
    expect(env.SMTP_USER).toBeUndefined();
  });

  it("пишет одно структурированное предупреждение без секретов", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const getRuntimeEnv = await load({
        NODE_ENV: "production",
        APP_URL: "https://quiz.example.com",
        QUIZ_FORCE_OPEN: "true",
        ...stagingCreds
      });
      getRuntimeEnv();
      getRuntimeEnv();
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = String(warn.mock.calls[0][0]);
      expect(JSON.parse(logged)).toMatchObject({ event: "staging_mode_enabled", appHost: "quiz.example.com", forceOpen: true });
      for (const secret of [stagingCreds.STAGING_PASSWORD, base.ADMIN_PASSWORD, base.DATABASE_URL]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("без staging-креденшелов предупреждения нет", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      (await load({ NODE_ENV: "production", APP_URL: "https://quiz.example.com" }))();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("isForceOpenAllowed", () => {
  const env = { APP_URL: "http://localhost:3000", QUIZ_FORCE_OPEN: true, QUIZ_LOCAL_STACK: false, NODE_ENV: "production" } as const;

  it("учитывает флаг, окружение, маркер и адрес", async () => {
    const { isForceOpenAllowed } = await import("@/server/env");
    expect(isForceOpenAllowed({ ...env, QUIZ_FORCE_OPEN: false, NODE_ENV: "development" })).toBe(false);
    expect(isForceOpenAllowed({ ...env, NODE_ENV: "development" })).toBe(true);
    expect(isForceOpenAllowed(env)).toBe(false);
    expect(isForceOpenAllowed({ ...env, QUIZ_LOCAL_STACK: true })).toBe(true);
    expect(isForceOpenAllowed({ ...env, QUIZ_LOCAL_STACK: true, APP_URL: "https://quiz.example.com" })).toBe(false);
    const publicUrl = { ...env, APP_URL: "https://quiz.example.com" };
    expect(isForceOpenAllowed({ ...publicUrl, ...stagingCreds })).toBe(true);
    expect(isForceOpenAllowed({ ...publicUrl, STAGING_USERNAME: "preview" })).toBe(false);
    expect(isForceOpenAllowed({ ...publicUrl, QUIZ_FORCE_OPEN: false, ...stagingCreds })).toBe(false);
  });
});
