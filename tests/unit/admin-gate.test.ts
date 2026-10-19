import { describe, expect, it } from "vitest";

import { authenticateAdmin } from "@/server/admin-auth";
import { adminGate, isAdminPagePath } from "@/server/admin-gate";

const env = { ADMIN_USERNAME: "operator", ADMIN_PASSWORD: "operator-password-16+", TENANT: "demo-office" };
// Проверка как в proxy, но без базы: единственный арендатор процесса, логинов из БД нет.
const authorize = async (headers: Headers) =>
  (await authenticateAdmin(headers.get("authorization"), { tenantSlug: "demo-office", env, findAdmin: async () => null })) !== null;
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
const req = (pathname: string, authorization?: string) => ({
  headers: new Headers(authorization ? { authorization } : {}),
  nextUrl: { pathname }
});

const REALM = "Quiz";

describe("adminGate", () => {
  it("распознаёт страницы оператора с учётом регистра, кодирования и слэшей", () => {
    for (const path of ["/admin", "/admin/", "/admin/x", "/Admin", "/%61dmin", "//admin", "/admin//x"]) {
      expect(isAdminPagePath(path), path).toBe(true);
    }
    for (const path of ["/", "/administrator", "/admin-x", "/api/admin/metrics", "/share/admin", "/x/admin"]) {
      expect(isAdminPagePath(path), path).toBe(false);
    }
  });

  it("не падает на некорректном %-кодировании", () => {
    expect(isAdminPagePath("/admin%zz")).toBe(false);
    expect(isAdminPagePath("/%zz")).toBe(false);
  });

  it("без заголовка, с чужим паролем и не-Basic схемой — 401 без кэша и индексации", async () => {
    for (const authorization of [undefined, basic("operator", "wrong-password-16+chars"), basic("other", env.ADMIN_PASSWORD), `Bearer ${env.ADMIN_PASSWORD}`]) {
      const response = await adminGate(req("/admin", authorization), authorize, REALM);
      expect(response?.status, String(authorization)).toBe(401);
      expect(response?.headers.get("cache-control")).toBe("no-store");
      expect(response?.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });

  it("с верным паролем пропускает, чужие пути не трогает", async () => {
    expect(await adminGate(req("/admin", basic("operator", env.ADMIN_PASSWORD)), authorize, REALM)).toBeNull();
    expect(await adminGate(req("/"), authorize, REALM)).toBeNull();
  });
});
