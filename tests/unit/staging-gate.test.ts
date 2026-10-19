import { describe, expect, it } from "vitest";

import { isStagingExempt, stagingGate } from "@/server/staging-gate";

const env = { STAGING_USERNAME: "preview", STAGING_PASSWORD: "staging-password-16+chars" };
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
const req = (pathname: string, authorization?: string) => ({
  headers: new Headers(authorization ? { authorization } : {}),
  nextUrl: { pathname }
});

const REALM = "Quiz staging";

describe("stagingGate", () => {
  it("ничего не закрывает без staging-креденшелов", () => {
    expect(stagingGate(req("/"), {}, REALM)).toBeNull();
    expect(stagingGate(req("/api/sessions"), { STAGING_USERNAME: "preview" }, REALM)).toBeNull();
  });

  it("отвечает 401 с Basic-challenge на страницы и публичное API без авторизации", () => {
    for (const path of ["/", "/verify", "/api/sessions", "/api/sessions/abc", "/api/ready", "/api/claims/verify", "/_next/image", "/_next/data/x.json", "/art/x.png", "/robots.txt"]) {
      const response = stagingGate(req(path), env, REALM);
      expect(response?.status, path).toBe(401);
      expect(response?.headers.get("www-authenticate")).toMatch(/^Basic realm="Quiz staging"/);
      expect(response?.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("пропускает с верными креденшелами", () => {
    expect(stagingGate(req("/", basic("preview", env.STAGING_PASSWORD)), env, REALM)).toBeNull();
    expect(stagingGate(req("/api/sessions", basic("preview", env.STAGING_PASSWORD)), env, REALM)).toBeNull();
  });

  it("отвечает 401 на неверный пароль, неверного пользователя и не-Basic схемы", () => {
    for (const authorization of [
      basic("preview", "wrong-password-16+chars"),
      basic("intruder", env.STAGING_PASSWORD),
      basic("preview", env.STAGING_PASSWORD.slice(0, -1)),
      `Bearer ${env.STAGING_PASSWORD}`,
      "Basic !!!",
      "Basic "
    ]) {
      expect(stagingGate(req("/", authorization), env, REALM)?.status, authorization).toBe(401);
    }
  });

  it("не закрывает /api/health и оставляет /api/admin/* собственной авторизации", () => {
    expect(stagingGate(req("/api/health"), env, REALM)).toBeNull();
    expect(stagingGate(req("/api/admin/metrics"), env, REALM)).toBeNull();
    expect(stagingGate(req("/api/admin/claims.csv"), env, REALM)).toBeNull();
  });

  it("не закрывает хешированную статику /_next/static/*, чтобы /admin под ADMIN-паролем получал CSS и JS", () => {
    for (const path of ["/_next/static/chunks/a.js", "/_next/static/css/b.css", "/_next/static/media/f.woff2"]) {
      expect(isStagingExempt(path), path).toBe(true);
      expect(stagingGate(req(path), env, REALM), path).toBeNull();
    }
  });

  it("оставляет страницы оператора /admin собственной авторизации", () => {
    for (const path of ["/admin", "/admin/", "/admin/claims"]) {
      expect(isStagingExempt(path), path).toBe(true);
      expect(stagingGate(req(path), env, REALM), path).toBeNull();
    }
  });

  it("исключения точные: похожие пути закрыты", () => {
    for (const path of ["/api/healthz", "/api/health/x", "/api/administrator", "/api/admin-x", "/x/api/admin/metrics", "/administrator", "/admin-x", "/Admin", "/%61dmin", "/x/admin", "/_next/static", "/_next/staticx/a.js", "/x/_next/static/a.js", "/_Next/static/a.js"]) {
      expect(isStagingExempt(path), path).toBe(false);
      expect(stagingGate(req(path), env, REALM)?.status, path).toBe(401);
    }
  });
});
