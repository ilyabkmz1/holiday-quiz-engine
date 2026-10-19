import { describe, expect, it } from "vitest";

import { packSchema } from "@/config/pack";
import {
  activeTenants,
  adventTenantFromHeaders,
  campaignSlugOf,
  tenantFromHeaders,
  assertTenantsConfigured,
  findTenant,
  loadTenants,
  tenantBaseUrl,
  tenantForHost,
  type Tenant
} from "@/server/tenants";
import { pack as officePack } from "@tenants/demo-office/pack";

import { adventPackFixture } from "../fixtures/advent";
import { smallCampaign } from "../support/small-campaign";

const office = officePack as Tenant;
const small = (tenant: string, hosts: string[] = []): Tenant =>
  packSchema.parse({ tenant, hosts, campaign: smallCampaign(`${tenant}-campaign`) });

describe("loadTenants", () => {
  it("загружает встроенные пакеты и проверяет их схемой", () => {
    const tenants = loadTenants();
    expect(tenants.map((tenant) => tenant.tenant)).toContain("demo-office");
  });

  it("отвергает повтор tenant, campaign.slug и host", () => {
    expect(() => loadTenants([office, office])).toThrow(/tenant/);
    expect(() => loadTenants([small("alpha"), { ...small("beta"), campaign: small("alpha").campaign }])).toThrow(/campaign\.slug/);
    expect(() => loadTenants([small("alpha", ["x.test"]), small("beta", ["x.test"])])).toThrow(/host/);
  });

  it("отвергает пакет с невалидным slug или хостом со схемой", () => {
    expect(() => loadTenants([{ ...office, tenant: "Bad Slug" }])).toThrow();
    expect(() => loadTenants([{ ...office, hosts: ["https://x.test/path"] }])).toThrow();
  });
});

describe("findTenant", () => {
  const a = small("alpha", ["alpha.example.com"]);
  const b = small("beta", ["Beta.Example.com:8443"]);
  const tenants = [a, b];

  it("TENANT перебивает Host", () => {
    expect(findTenant("beta.example.com", { TENANT: "alpha" }, tenants)?.tenant).toBe("alpha");
    expect(() => findTenant(null, { TENANT: "ghost" }, tenants)).toThrow(/ghost/);
  });

  it("находит по точному Host без учёта регистра", () => {
    expect(findTenant("ALPHA.example.com", { NODE_ENV: "production" }, tenants)?.tenant).toBe("alpha");
    expect(findTenant("beta.example.com:8443", { NODE_ENV: "production" }, tenants)?.tenant).toBe("beta");
  });

  it("находит поддомен общего домена", () => {
    const env = { NODE_ENV: "production", TENANT_BASE_DOMAIN: "quiz.example.org" };
    expect(findTenant("beta.quiz.example.org", env, tenants)?.tenant).toBe("beta");
    expect(findTenant("ghost.quiz.example.org", env, tenants)).toBeNull();
  });

  it("чужой Host в production при нескольких пакетах не получает случайный квиз", () => {
    expect(findTenant("evil.test", { NODE_ENV: "production" }, tenants)).toBeNull();
    expect(findTenant("evil.test", { NODE_ENV: "production" }, [a])?.tenant).toBe("alpha");
    expect(findTenant("localhost:3000", { NODE_ENV: "development" }, tenants)?.tenant).toBe("alpha");
  });
});

describe("assertTenantsConfigured / activeTenants", () => {
  const a = small("alpha");
  const b = small("beta");

  it("в production с несколькими пакетами без TENANT и TENANT_BASE_DOMAIN падает при старте, хосты в пакетах это не обходят", () => {
    expect(() => assertTenantsConfigured({ NODE_ENV: "production" }, [a, b])).toThrow(/TENANT/);
    expect(() => assertTenantsConfigured({ NODE_ENV: "production", TENANT: "alpha" }, [a, b])).not.toThrow();
    expect(() => assertTenantsConfigured({ NODE_ENV: "production", TENANT_BASE_DOMAIN: "quiz.example.com" }, [a, b])).not.toThrow();
    expect(() => assertTenantsConfigured({ NODE_ENV: "production" }, [a])).not.toThrow();
    // Хосты вроде demo-coffee.localhost:3000 не должны включать многоарендный режим в боевом образе.
    expect(() => assertTenantsConfigured({ NODE_ENV: "production" }, [small("alpha", ["alpha.localhost:3000"]), b])).toThrow(/TENANT/);
    expect(() => assertTenantsConfigured({ NODE_ENV: "production" }, [small("alpha", ["alpha.test"]), small("beta", ["beta.test"])])).toThrow(/TENANT/);
    expect(() => assertTenantsConfigured({ NODE_ENV: "development" }, [a, b])).not.toThrow();
  });

  it("юр.проверка при запуске идёт по выбранному TENANT или по всем пакетам", () => {
    expect(activeTenants({ TENANT: "beta" }, [a, b]).map((tenant) => tenant.tenant)).toEqual(["beta"]);
    expect(activeTenants({}, [a, b])).toHaveLength(2);
  });
});

describe("tenantBaseUrl", () => {
  it("берёт первый хост пакета и схему APP_URL, иначе APP_URL", () => {
    expect(tenantBaseUrl(small("alpha", ["alpha.test"]), "https://quiz.example.com")).toBe("https://alpha.test");
    expect(tenantBaseUrl(small("alpha"), "https://quiz.example.com")).toBe("https://quiz.example.com");
  });
});

describe("общий домен TENANT_BASE_DOMAIN", () => {
  const env = { NODE_ENV: "production", TENANT_BASE_DOMAIN: "quiz.example.org" };
  const tenants = [small("alpha", ["alpha.test"]), small("beta")];

  it("tenantForHost: свой хост или поддомен, без запасного варианта", () => {
    expect(tenantForHost("alpha.test", env, tenants)?.tenant).toBe("alpha");
    expect(tenantForHost("beta.quiz.example.org", env, tenants)?.tenant).toBe("beta");
    expect(tenantForHost("evil.test", { NODE_ENV: "development" }, tenants)).toBeNull();
  });

  it("tenantBaseUrl: поддомен для пакета без hosts (ссылка из письма ведёт на домен арендатора)", () => {
    expect(tenantBaseUrl(tenants[1], "https://quiz.example.org", env)).toBe("https://beta.quiz.example.org");
    expect(tenantBaseUrl(tenants[1], "http://localhost:3000", { TENANT_BASE_DOMAIN: "localhost" })).toBe("http://beta.localhost:3000");
    expect(tenantBaseUrl(tenants[1], "https://quiz.example.org", { ...env, TENANT: "beta" })).toBe("https://quiz.example.org");
  });
});

describe("реестр с квизами и адвентами", () => {
  const quiz = small("alpha", ["alpha.example.com"]);
  const advent = loadTenants([adventPackFixture()])[0];
  const tenants = loadTenants([quiz, { ...adventPackFixture(), hosts: ["advent.example.com"] }]);

  it("slug кампании адвента участвует в проверке уникальности", () => {
    const clash = { ...adventPackFixture(), tenant: "other-advent", hosts: [] };
    expect(() => loadTenants([adventPackFixture(), clash])).toThrow(/campaign\.slug/);
    expect(campaignSlugOf(advent)).toBe("zerno-advent-2026");
  });

  it("находит арендатора обоих видов по Host", () => {
    expect(findTenant("advent.example.com", { NODE_ENV: "production" }, tenants)?.experience).toBe("advent");
    expect(findTenant("alpha.example.com", { NODE_ENV: "production" }, tenants)?.experience).toBe("quiz");
  });

  it("квизовый помощник на адвент-хосте — not_found, адвентовый на квизе — тоже", async () => {
    const { overrideTenants } = await import("@/server/tenants");
    overrideTenants(tenants);
    try {
      const headers = (host: string) => ({ get: (name: string) => (name === "host" ? host : null) });
      expect(() => tenantFromHeaders(headers("advent.example.com"))).toThrow(/Квиз по этому адресу не найден/);
      expect(() => adventTenantFromHeaders(headers("alpha.example.com"))).toThrow(/Адвент по этому адресу не найден/);
      expect(tenantFromHeaders(headers("alpha.example.com")).tenant).toBe("alpha");
      expect(adventTenantFromHeaders(headers("advent.example.com")).tenant).toBe("zerno-advent");
    } finally {
      overrideTenants(null);
    }
  });
});
