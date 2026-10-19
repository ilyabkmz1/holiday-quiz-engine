import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";
import { getRuntimeEnv, resetRuntimeEnvCache } from "@/server/env";

import { adminHeaders, adminMetrics, api, completedPlayer, healthGET, installFakes, makeRequest, readyGET } from "./helpers/app";
import { TEST_APP_URL, UPCOMING_NOW } from "./helpers/constants";

const STAGING_USER = "preview";
const STAGING_PASSWORD = "staging-password-16+chars";
const stagingAuth = { authorization: `Basic ${Buffer.from(`${STAGING_USER}:${STAGING_PASSWORD}`).toString("base64")}` };

function enableStaging(extra: Record<string, string> = {}) {
  vi.stubEnv("STAGING_USERNAME", STAGING_USER);
  vi.stubEnv("STAGING_PASSWORD", STAGING_PASSWORD);
  vi.stubEnv("NODE_ENV", "production");
  // В production при нескольких пакетах в образе арендатор задаётся явно (как TENANT в deploy/compose.yml).
  vi.stubEnv("TENANT", "demo-office");
  vi.stubEnv("APP_URL", "http://quiz.test");
  for (const [key, value] of Object.entries(extra)) vi.stubEnv(key, value);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

/** Цепочка как в Next: сначала proxy, затем (если он пропустил) route handler. */
async function through(path: string, handler: (request: NextRequest) => Promise<Response> | Response, headers: Record<string, string> = {}, method = "GET") {
  const request = makeRequest(path, { method, headers });
  const gate = await proxy(request);
  if (gate.headers.get("x-middleware-next") !== "1") return gate;
  return handler(request);
}

describe("staging: закрытый стенд (proxy + route handlers, PostgreSQL)", () => {
  it("без креденшелов: 401 на страницы и API, /api/health открыт", async () => {
    enableStaging();
    const sessions = await through("/api/sessions", () => api.createSession(), {}, "POST");
    expect(sessions.status).toBe(401);
    expect(sessions.headers.get("www-authenticate")).toMatch(/^Basic /);
    expect((await through("/", () => new Response("page"))).status).toBe(401);
    expect((await through("/api/ready", () => readyGET())).status).toBe(401);
    expect((await through("/api/health", () => healthGET())).status).toBe(200);
  });

  it("с креденшелами: 200 на страницы, ready и создание сессии", async () => {
    enableStaging({ QUIZ_FORCE_OPEN: "true" });
    installFakes(UPCOMING_NOW);
    expect((await through("/", () => new Response("page"), stagingAuth)).status).toBe(200);
    expect((await through("/api/ready", () => readyGET(), stagingAuth)).status).toBe(200);
    const created = await through("/api/sessions", () => api.createSession({ headers: stagingAuth }), stagingAuth, "POST");
    expect(created.status).toBe(200);
  });

  it("force-open в staging открывает квиз вне дат кампании; без него — «закрыт»", async () => {
    enableStaging();
    installFakes(UPCOMING_NOW);
    expect((await api.createSession()).status).toBe(403);
  });

  it("два Basic auth: /api/admin/* не закрыт staging-паролем, но требует ADMIN_*", async () => {
    enableStaging();
    // Админский пароль проходит proxy и принимается admin-handler'ом.
    const ok = await through("/api/admin/metrics", () => adminMetrics(makeRequest("/api/admin/metrics", { headers: adminHeaders() })), adminHeaders());
    expect(ok.status).toBe(200);
    // Без админской авторизации — 401 от самого endpoint'а, а не от staging-proxy.
    const anon = await through("/api/admin/metrics", () => adminMetrics(makeRequest("/api/admin/metrics")));
    expect(anon.status).toBe(401);
    expect(anon.headers.get("www-authenticate")).toContain('realm="Quiz"');
    // Staging-пароль админский endpoint не открывает.
    const stagingOnly = await through("/api/admin/metrics", () => adminMetrics(makeRequest("/api/admin/metrics", { headers: stagingAuth })), stagingAuth);
    expect(stagingOnly.status).toBe(401);
  });

  it("статика /_next/static/* открыта без пароля, страницы игры и /share закрыты", async () => {
    enableStaging();
    expect((await through("/_next/static/chunks/a.js", () => new Response("js"))).status).toBe(200);
    for (const path of ["/", "/verify", "/share/x", "/share/x/image", "/_next/image?url=%2Fa"]) {
      expect((await through(path, () => new Response("page"))).status, path).toBe(401);
    }
  });

  it("картинка «Поделиться» на staging кэшируется только приватно, на открытом сайте — публично", async () => {
    const { GET: imageGET } = await import("@/app/share/[sessionId]/image/route");
    installFakes();
    const player = await completedPlayer();
    const call = () => imageGET(new Request(`${TEST_APP_URL}/share/${player.sessionId}/image`), { params: Promise.resolve({ sessionId: player.sessionId }) });

    expect((await call()).headers.get("cache-control")).toMatch(/^public, /);
    enableStaging();
    resetRuntimeEnvCache();
    const staged = await call();
    expect(staged.status).toBe(200);
    expect(staged.headers.get("cache-control")).toMatch(/^private/);
    expect(staged.headers.get("cache-control")).not.toMatch(/public|s-maxage/);
  });

  it("лимит /share/*: 60 запросов в минуту на IP, query не помогает обойти, другие IP и API не затронуты", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // В production при нескольких пакетах в образе арендатор задаётся явно (как TENANT в deploy/compose.yml).
    vi.stubEnv("TENANT", "demo-office");
    vi.stubEnv("APP_URL", "http://quiz.test");
    const hit = (path: string, ip: string) => proxy(makeRequest(path, { headers: { "x-forwarded-for": ip } }));
    for (let index = 0; index < 60; index += 1) {
      const path = index % 2 ? `/share/abc?v=${index}` : `/share/abc/image?v=${index}`;
      expect((await hit(path, "203.0.113.7")).status, path).toBe(200);
    }
    const limited = await hit("/share/abc/image?v=fresh", "203.0.113.7");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await hit("/%73hare/abc", "203.0.113.7")).status).toBe(429);
    expect((await hit("/share/abc", "203.0.113.8")).status).toBe(200);
    expect((await hit("/api/health", "203.0.113.7")).status).toBe(200);
  });

  it("production без staging-креденшелов: force-open с публичным APP_URL — ошибка конфигурации", () => {
    vi.stubEnv("NODE_ENV", "production");
    // В production при нескольких пакетах в образе арендатор задаётся явно (как TENANT в deploy/compose.yml).
    vi.stubEnv("TENANT", "demo-office");
    vi.stubEnv("APP_URL", "https://quiz.example.com");
    vi.stubEnv("QUIZ_FORCE_OPEN", "true");
    expect(() => getRuntimeEnv()).toThrow("QUIZ_FORCE_OPEN cannot be enabled in production");
  });

  it("production без staging: proxy ничего не закрывает, квиз закрыт по датам", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // В production при нескольких пакетах в образе арендатор задаётся явно (как TENANT в deploy/compose.yml).
    vi.stubEnv("TENANT", "demo-office");
    vi.stubEnv("APP_URL", "http://quiz.test");
    installFakes(UPCOMING_NOW);
    expect((await through("/", () => new Response("page"))).status).toBe(200);
    expect((await through("/api/sessions", () => api.createSession(), {}, "POST")).status).toBe(403);
  });
});
