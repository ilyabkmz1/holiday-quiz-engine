import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const base = {
  DATABASE_URL: "postgresql://quiz:quiz@127.0.0.1:5432/quiz",
  APP_URL: "https://quiz.example.com",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_FROM: "quiz@example.test",
  ADMIN_USERNAME: "operator",
  ADMIN_PASSWORD: "local-password-at-least-16",
  // В образе два пакета: без TENANT в production арендатор по чужому Host не определяется,
  // а админ из окружения действует только при TENANT (или SUPERADMIN=true).
  TENANT: "demo-office"
};
const staging = { STAGING_USERNAME: "preview", STAGING_PASSWORD: "staging-password-16+chars" };
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

async function loadProxy(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries({ ...base, ...env })) vi.stubEnv(key, value);
  return (await import("@/proxy")).proxy;
}
const request = (path: string, authorization?: string) =>
  new NextRequest(`https://quiz.example.com${path}`, { headers: authorization ? { authorization } : {} });
const passesThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("в production-режиме (без staging-креденшелов) пропускает всё", async () => {
    const proxy = await loadProxy({ NODE_ENV: "production" });
    for (const path of ["/", "/api/sessions", "/api/ready"]) expect(passesThrough(await proxy(request(path))), path).toBe(true);
  });

  it("в staging без креденшелов: 401 на страницы и API, health открыт", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const proxy = await loadProxy({ NODE_ENV: "production", ...staging });
      for (const path of ["/", "/verify", "/api/sessions", "/api/ready"]) expect((await proxy(request(path))).status, path).toBe(401);
      expect(passesThrough(await proxy(request("/api/health")))).toBe(true);
      expect(passesThrough(await proxy(request("/api/admin/metrics")))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("в staging с креденшелами пропускает запрос дальше", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const proxy = await loadProxy({ NODE_ENV: "production", ...staging });
      const auth = basic(staging.STAGING_USERNAME, staging.STAGING_PASSWORD);
      expect(passesThrough(await proxy(request("/", auth)))).toBe(true);
      expect(passesThrough(await proxy(request("/api/sessions", auth)))).toBe(true);
      expect((await proxy(request("/", basic("preview", "nope-nope-nope-nope")))).status).toBe(401);
    } finally {
      warn.mockRestore();
    }
  });
  it("в staging нет обхода через регистр, кодирование, слэш, точки и методы", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const proxy = await loadProxy({ NODE_ENV: "production", ...staging });
      for (const path of [
        "/API/health",
        "/api/Health",
        "/api/health/",
        "/api/%68ealth",
        "/api/health%2F",
        "/api/health/..",
        "/api/health/../sessions",
        "/api/health;x",
        "/api/health.json",
        "/API/admin/metrics",
        "/api/%61dmin/metrics",
        "/api/admin%2Fmetrics",
        "/api/./admin/../sessions",
        "/_next/static/../api/sessions",
        "/_next/static/%2e%2e/api/sessions",
        "/_next/image",
        "/_next/data/x.json",
        "/art/hero.png"
      ]) {
        for (const method of ["GET", "HEAD", "OPTIONS", "POST"]) {
          const req = new NextRequest(`https://quiz.example.com${path}`, { method });
          const exempt = new URL(req.url).pathname;
          if (exempt === "/api/health" || exempt.startsWith("/api/admin/") || exempt.startsWith("/_next/static/")) continue; // нормализованный путь исключения
          expect((await proxy(req)).status, `${method} ${path}`).toBe(401);
        }
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("в staging статика /_next/static/* открыта без пароля, страницы игры, API и остальной /_next закрыты", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const proxy = await loadProxy({ NODE_ENV: "production", ...staging });
      for (const path of ["/_next/static/chunks/a.js", "/_next/static/css/b.css"]) expect(passesThrough(await proxy(request(path))), path).toBe(true);
      for (const path of ["/", "/verify", "/share/x", "/api/sessions", "/api/ready", "/_next/image?url=%2Fa", "/_next/data/x.json"]) {
        expect((await proxy(request(path))).status, path).toBe(401);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("staging-пароль не заменяет ADMIN_* и не нужен для health", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const proxy = await loadProxy({ NODE_ENV: "production", ...staging });
      for (const method of ["GET", "HEAD", "OPTIONS"]) {
        expect(passesThrough(await proxy(new NextRequest("https://quiz.example.com/api/health", { method })))).toBe(true);
      }
      // /api/admin/* пропускается прокси без подмены: проверку ADMIN_* делает сам route handler.
      expect(passesThrough(await proxy(request("/api/admin/metrics", basic("preview", staging.STAGING_PASSWORD))))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("при невалидной конфигурации прокси падает на любом пути, игроков не обслуживаем", async () => {
    const proxy = await loadProxy({ NODE_ENV: "production", APP_URL: "not-a-url" });
    for (const path of ["/", "/api/sessions", "/api/health"]) await expect(proxy(request(path)), path).rejects.toThrow();
    const forced = await loadProxy({ NODE_ENV: "production", QUIZ_FORCE_OPEN: "true" });
    for (const path of ["/", "/api/sessions"]) await expect(forced(request(path)), path).rejects.toThrow(/QUIZ_FORCE_OPEN/);
  });

  describe("/admin", () => {
    const admin = { user: base.ADMIN_USERNAME, pass: base.ADMIN_PASSWORD };
    const realm = (response: Response) => response.headers.get("www-authenticate");

    it("в production без пароля — 401, с ADMIN_* — пропускает", async () => {
      const proxy = await loadProxy({ NODE_ENV: "production" });
      for (const path of ["/admin", "/admin/", "/admin/claims"]) {
        const denied = await proxy(request(path));
        expect(denied.status, path).toBe(401);
        expect(realm(denied)).toBe('Basic realm="Quiz", charset="UTF-8"');
        expect(passesThrough(await proxy(request(path, basic(admin.user, admin.pass)))), path).toBe(true);
      }
      expect((await proxy(request("/admin", basic(admin.user, "wrong-password-16+chars")))).status).toBe(401);
    });

    it("в staging staging-пароль /admin не открывает, а ADMIN_* открывает без staging-пароля", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const proxy = await loadProxy({ NODE_ENV: "production", ...staging });
        const stagingAuth = basic(staging.STAGING_USERNAME, staging.STAGING_PASSWORD);
        const noAuth = await proxy(request("/admin"));
        expect(noAuth.status).toBe(401);
        // Вызов именно операторский, а не staging: иначе браузер спросил бы не тот пароль.
        expect(realm(noAuth)).toMatch(/^Basic realm="Quiz",/);
        expect((await proxy(request("/admin", stagingAuth))).status).toBe(401);
        expect(passesThrough(await proxy(request("/admin", basic(admin.user, admin.pass))))).toBe(true);
        expect(passesThrough(await proxy(request("/admin/", basic(admin.user, admin.pass))))).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });

    it("не обходится регистром, %-кодированием и двойными слэшами", async () => {
      const proxy = await loadProxy({ NODE_ENV: "production" });
      for (const path of ["/Admin", "/ADMIN/x", "/%61dmin", "/%41dmin/x", "//admin", "/admin%2Fx", "/admin//x"]) {
        for (const method of ["GET", "HEAD", "POST"]) {
          const response = await proxy(new NextRequest(`https://quiz.example.com${path}`, { method }));
          expect(response.status, `${method} ${path}`).toBe(401);
        }
      }
    });

    it("не трогает похожие публичные пути", async () => {
      const proxy = await loadProxy({ NODE_ENV: "production" });
      for (const path of ["/administrator", "/admin-panel", "/share/admin", "/x/admin"]) {
        expect(passesThrough(await proxy(request(path))), path).toBe(true);
      }
    });
  });
});
