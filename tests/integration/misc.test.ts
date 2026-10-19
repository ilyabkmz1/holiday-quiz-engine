import { describe, expect, it, vi } from "vitest";

import { publicApiRateLimiter, sessionCreationRateLimiter } from "@/server/rate-limit";
import { getPrisma } from "@/server/db";

import { api, completedPlayer, healthGET, installFakes, readyGET, startSession, verifiedClaim } from "./helpers/app";
import { consoleLog } from "./helpers/leak-guard";

describe("health and readiness", () => {
  it("GET /api/health answers 200 without touching the database", async () => {
    const response = healthGET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", version: process.env.APP_VERSION?.trim() || "dev" });
  });

  it("GET /api/ready answers 200 with a working database", async () => {
    const response = await readyGET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("GET /api/ready answers 503 when the database is unavailable, without error details", async () => {
    const spy = vi.spyOn(getPrisma(), "$queryRaw").mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.1:5432"));
    const response = await readyGET();
    spy.mockRestore();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});

describe("rate limit", () => {
  it("answers 429 once a client exceeds the limit and does not do the work", async () => {
    installFakes();
    publicApiRateLimiter.setLimit(3);
    const headers = { "x-forwarded-for": "203.0.113.7" };

    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      statuses.push((await api.createSession({ headers })).status);
    }

    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(await getPrisma().gameSession.count()).toBe(3);
  });

  it("limits session creation to 60 a minute per client, separately from the general limit", async () => {
    installFakes();
    const headers = { "x-forwarded-for": "203.0.113.50" };

    let created = 0;
    for (let index = 0; index < 60; index += 1) {
      if ((await api.createSession({ headers })).status === 200) created += 1;
    }
    const limited = await api.createSession({ headers });
    const otherClient = await api.createSession({ headers: { "x-forwarded-for": "203.0.113.51" } });

    expect(created).toBe(60);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toMatch(/Слишком много новых игр/);
    expect(otherClient.status).toBe(200);
    expect(await getPrisma().gameSession.count()).toBe(61);

    // Чтение чужой сессии общим лимитом не страдает, а после сброса создание снова работает.
    sessionCreationRateLimiter.reset();
    expect((await api.createSession({ headers })).status).toBe(200);
  });

  it("returns a Russian message and counts clients separately", async () => {
    installFakes();
    publicApiRateLimiter.setLimit(1);
    await api.createSession({ headers: { "x-forwarded-for": "203.0.113.7" } });

    const limited = await api.createSession({ headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
    const other = await api.createSession({ headers: { "x-forwarded-for": "203.0.113.8" } });

    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toMatch(/Слишком много запросов/);
    expect(other.status).toBe(200);
  });

  it("applies to reads and to the verification link, and is resettable", async () => {
    installFakes();
    const player = await startSession();
    publicApiRateLimiter.reset();
    publicApiRateLimiter.setLimit(1);

    expect((await api.getSession(player.sessionId, player.accessKey)).status).toBe(200);
    expect((await api.getSession(player.sessionId, player.accessKey)).status).toBe(429);
    expect((await api.verify("x".repeat(40))).status).toBe(429);

    publicApiRateLimiter.reset();
    expect((await api.getSession(player.sessionId, player.accessKey)).status).toBe(200);
  });

  it("checks the rate limit before the Origin", async () => {
    installFakes();
    publicApiRateLimiter.setLimit(1);
    await api.createSession();

    const response = await api.createSession({ origin: "https://evil.example" });

    expect(response.status).toBe(429);
  });

  it("does not apply to health", async () => {
    publicApiRateLimiter.setLimit(1);
    for (let index = 0; index < 3; index += 1) {
      expect(healthGET().status).toBe(200);
    }
  });
});

describe("logging", () => {
  it("emits only structured events without email, token, form fields or credentials", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "pii.person@example.com", name: "Секретное Имя", company: "Секретная Компания" });
    mailer.failNext = 1;
    const failing = await completedPlayer();
    await api.claim(failing.sessionId, failing.accessKey, {
      name: "Другое Имя", email: "other.pii@example.com", company: "Другая Компания", consent: true
    });
    await api.getSession("not-a-uuid", failing.accessKey);
    await api.verify("x".repeat(40));

    const lines = consoleLog.entries();

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(typeof parsed.event).toBe("string");
      expect(line).not.toMatch(/@|example\.com|Секретн|Друг|token=/);
    }
    expect(lines.map((line) => (JSON.parse(line) as { event: string }).event)).toEqual(
      expect.arrayContaining(["session_started", "session_completed", "claim_created", "claim_verified", "claim_verification_failed", "api_error"])
    );
  });
});
