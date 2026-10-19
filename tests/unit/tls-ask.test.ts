import { describe, expect, it } from "vitest";

import { packSchema } from "@/config/pack";
import { isStagingExempt } from "@/server/staging-gate";
import { overrideTenants, type Tenant } from "@/server/tenants";
import { tlsAskDecision } from "@/server/tls-ask";

import { smallCampaign } from "../support/small-campaign";

const tenants = [
  packSchema.parse({ tenant: "alpha", hosts: ["quiz.alpha-client.ru"], campaign: smallCampaign("alpha-campaign") }),
  packSchema.parse({ tenant: "beta", hosts: [], campaign: smallCampaign("beta-campaign") })
] as Tenant[];
const env = { TLS_ASK_TOKEN: "ask-secret-token", TENANT_BASE_DOMAIN: "quiz.example.com" };

describe("tlsAskDecision (on-demand TLS для Caddy)", () => {
  it("разрешает поддомен арендатора и собственный домен клиента, остальное — 404", () => {
    overrideTenants(tenants);
    try {
      expect(tlsAskDecision("alpha.quiz.example.com", env.TLS_ASK_TOKEN, env)).toBe(200);
      expect(tlsAskDecision("BETA.quiz.example.com.", env.TLS_ASK_TOKEN, env)).toBe(200);
      expect(tlsAskDecision("quiz.alpha-client.ru", env.TLS_ASK_TOKEN, env)).toBe(200);
      for (const domain of ["gamma.quiz.example.com", "quiz.example.com", "evil.example.org", "alpha.quiz.example.com.evil.org", "127.0.0.1", "", null, "a b.example.com", "alpha.quiz.example.com:8443"]) {
        expect(tlsAskDecision(domain, env.TLS_ASK_TOKEN, env), String(domain)).toBe(404);
      }
    } finally {
      overrideTenants(null);
    }
  });

  it("без токена в окружении проверка выключена, с неверным токеном — 403", () => {
    overrideTenants(tenants);
    try {
      expect(tlsAskDecision("alpha.quiz.example.com", "x", { TENANT_BASE_DOMAIN: env.TENANT_BASE_DOMAIN })).toBe(404);
      expect(tlsAskDecision("alpha.quiz.example.com", null, env)).toBe(403);
      expect(tlsAskDecision("alpha.quiz.example.com", "wrong-token-value", env)).toBe(403);
    } finally {
      overrideTenants(null);
    }
  });

  it("без общего домена поддомены не работают, остаются только хосты пакетов", () => {
    overrideTenants(tenants);
    try {
      expect(tlsAskDecision("beta.quiz.example.com", env.TLS_ASK_TOKEN, { TLS_ASK_TOKEN: env.TLS_ASK_TOKEN })).toBe(404);
      expect(tlsAskDecision("quiz.alpha-client.ru", env.TLS_ASK_TOKEN, { TLS_ASK_TOKEN: env.TLS_ASK_TOKEN })).toBe(200);
    } finally {
      overrideTenants(null);
    }
  });

  it("путь проверки не закрыт staging-паролем: Caddy его не знает", () => {
    expect(isStagingExempt("/api/internal/tls-ask")).toBe(true);
    expect(isStagingExempt("/api/internal/other")).toBe(false);
  });
});
