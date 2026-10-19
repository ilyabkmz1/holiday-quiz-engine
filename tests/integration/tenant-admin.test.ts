import { beforeEach, describe, expect, it, vi } from "vitest";

import { packSchema } from "@/config/pack";
import { getPrisma } from "@/server/db";
import { proxy } from "@/proxy";
import { disableTenantAdmin, listTenantAdmins, saveTenantAdmin } from "@/server/tenant-admins";
import { overrideTenants, type Tenant } from "@/server/tenants";
import { campaign as officeCampaign } from "@tenants/demo-office/campaign";

import { GET as adminCsv } from "@/app/api/admin/claims.csv/route";
import { POST as adminExport } from "@/app/api/admin/claims/export/route";
import { GET as adminMetricsGet } from "@/app/api/admin/metrics/route";
import { installFakes, makeRequest } from "./helpers/app";
import { TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME } from "./helpers/constants";
import { sensitiveValues } from "./helpers/leak-guard";
import { smallCampaign } from "../support/small-campaign";

const office = packSchema.parse({ tenant: "demo-office", hosts: ["office.test"], campaign: officeCampaign }) as Tenant;
const second = packSchema.parse({ tenant: "second", hosts: ["second.test"], campaign: smallCampaign("second-campaign") }) as Tenant;

const basic = (user: string, pass: string) => ({ authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` });
const at = (path: string, host: string, headers: Record<string, string> = {}) => makeRequest(path, { headers: { host, ...headers } });

let officePassword = "";
let secondPassword = "";

beforeEach(async () => {
  installFakes();
  overrideTenants([office, second]);
  // Многоарендный режим без явного суперадмина: общий пароль окружения не действует.
  vi.stubEnv("SUPERADMIN", "");
  vi.stubEnv("TENANT", "");
  const prisma = getPrisma();
  officePassword = (await saveTenantAdmin(prisma, { tenantSlug: "demo-office", username: "office-ops" })).password;
  secondPassword = (await saveTenantAdmin(prisma, { tenantSlug: "second", username: "second-ops" })).password;
  sensitiveValues.add(officePassword);
  sensitiveValues.add(secondPassword);
  return () => overrideTenants(null);
});

describe("админка арендатора: изоляция по Host", () => {
  it("свой оператор открывает CSV и метрики своего арендатора; файл называется по арендатору", async () => {
    const csv = await adminCsv(at("/api/admin/claims.csv", "second.test", basic("second-ops", secondPassword)));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toContain("second-quiz-claims.csv");
    const metrics = await adminMetricsGet(at("/api/admin/metrics", "office.test", basic("office-ops", officePassword)));
    expect(metrics.status).toBe(200);
  });

  it("оператор одного арендатора с подменой Host не получает данные другого: 401", async () => {
    // Верные логин и пароль office-ops, но Host второго арендатора.
    for (const handler of [adminCsv, adminMetricsGet]) {
      const response = await handler(at("/api/admin/claims.csv", "second.test", basic("office-ops", officePassword)));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Basic /);
    }
    expect((await adminCsv(at("/api/admin/claims.csv", "office.test", basic("second-ops", secondPassword)))).status).toBe(401);
  });

  it("общий пароль окружения без SUPERADMIN и без TENANT не открывает ничего, на любом Host", async () => {
    for (const host of ["office.test", "second.test", "unknown.test"]) {
      const response = await adminCsv(at("/api/admin/claims.csv", host, basic(TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD)));
      expect(response.status, host).toBe(401);
    }
  });

  it("явный SUPERADMIN включает общий пароль; TENANT делает его администратором только этого арендатора", async () => {
    vi.stubEnv("SUPERADMIN", "true");
    expect((await adminCsv(at("/api/admin/claims.csv", "second.test", basic(TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD)))).status).toBe(200);
    vi.stubEnv("SUPERADMIN", "");
    vi.stubEnv("TENANT", "demo-office");
    // Процесс обслуживает одного арендатора: Host его не меняет, поэтому подмена Host не открывает чужое.
    const response = await adminCsv(at("/api/admin/claims.csv", "second.test", basic(TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD)));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("demo-office-quiz-claims.csv");
  });

  it("отключённый оператор не входит, повторное создание с новым паролем возвращает доступ", async () => {
    const prisma = getPrisma();
    expect(await disableTenantAdmin(prisma, "second", "second-ops")).toBe(true);
    expect((await adminCsv(at("/api/admin/claims.csv", "second.test", basic("second-ops", secondPassword)))).status).toBe(401);
    const again = await saveTenantAdmin(prisma, { tenantSlug: "second", username: "second-ops" });
    sensitiveValues.add(again.password);
    expect(again.created).toBe(false);
    expect((await adminCsv(at("/api/admin/claims.csv", "second.test", basic("second-ops", secondPassword)))).status).toBe(401);
    expect((await adminCsv(at("/api/admin/claims.csv", "second.test", basic("second-ops", again.password)))).status).toBe(200);
  });

  it("в базе только хеш пароля, логины раздельны по арендаторам", async () => {
    const prisma = getPrisma();
    const rows = await prisma.tenantAdmin.findMany({ orderBy: { tenantSlug: "asc" } });
    expect(rows.map((row) => row.tenantSlug)).toEqual(["demo-office", "second"]);
    for (const row of rows) {
      expect(row.passwordHash).toMatch(/^scrypt\$/);
      expect(row.passwordHash).not.toContain(officePassword);
      expect(row.passwordHash).not.toContain(secondPassword);
    }
    // Один логин у двух арендаторов — две независимые строки.
    const sharedName = await saveTenantAdmin(prisma, { tenantSlug: "second", username: "office-ops" });
    sensitiveValues.add(sharedName.password);
    expect(sharedName.created).toBe(true);
    expect((await listTenantAdmins(prisma, "second")).map((row) => row.username).sort()).toEqual(["office-ops", "second-ops"]);
    expect((await adminCsv(at("/api/admin/claims.csv", "office.test", basic("office-ops", sharedName.password)))).status).toBe(401);
  });

  it("кнопка «выгружено» работает у оператора на его Host, чужой Origin — 403", async () => {
    const post = (host: string, origin: string) =>
      adminExport(makeRequest("/api/admin/claims/export", { method: "POST", origin, headers: { host, "sec-fetch-site": "same-origin", ...basic("second-ops", secondPassword) } }));
    expect((await post("second.test", "https://second.test")).status).toBe(200);
    expect((await post("second.test", "https://office.test")).status).toBe(403);
    expect((await post("second.test", "https://evil.example")).status).toBe(403);
  });

  it("страницы /admin за proxy: пропускает только своего оператора на своём Host", async () => {
    const page = async (host: string, headers: Record<string, string>) => proxy(at("/admin", host, headers));
    expect((await page("office.test", basic("office-ops", officePassword))).headers.get("x-middleware-next")).toBe("1");
    expect((await page("second.test", basic("office-ops", officePassword))).status).toBe(401);
    expect((await page("office.test", {})).status).toBe(401);
    expect((await page("office.test", basic(TEST_ADMIN_USERNAME, TEST_ADMIN_PASSWORD))).status).toBe(401);
  });

  it("перебор пароля упирается в лимит попыток по IP: после него даже верный пароль не проходит до конца окна", async () => {
    const attacker = { "x-forwarded-for": "198.51.100.9" };
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await adminCsv(at("/api/admin/claims.csv", "office.test", { ...attacker, ...basic("office-ops", `wrong-guess-${attempt}-xxxxxxxx`) }));
      expect(response.status).toBe(401);
    }
    expect((await adminCsv(at("/api/admin/claims.csv", "office.test", { ...attacker, ...basic("office-ops", officePassword) }))).status).toBe(401);
    // Другой IP не задет.
    expect((await adminCsv(at("/api/admin/claims.csv", "office.test", { "x-forwarded-for": "198.51.100.10", ...basic("office-ops", officePassword) }))).status).toBe(200);
  }, 60_000);

  it("слабый пароль и некорректный логин отвергаются при создании", async () => {
    const prisma = getPrisma();
    await expect(saveTenantAdmin(prisma, { tenantSlug: "second", username: "ops", password: "short" })).rejects.toThrow(/короче/);
    await expect(saveTenantAdmin(prisma, { tenantSlug: "second", username: "Bad Name" })).rejects.toThrow(/Логин/);
  });
});
