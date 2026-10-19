import { timingSafeEqual } from "node:crypto";

import { tenantForHost } from "@/server/tenants";

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

type AskEnv = { TLS_ASK_TOKEN?: string; TENANT_BASE_DOMAIN?: string };

function tokenMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Решение для Caddy (on-demand TLS, директива `ask`): выпускать ли сертификат для `domain`.
 * Разрешён только домен, который принадлежит арендатору: точное совпадение с `hosts` пакета или `<slug>.<TENANT_BASE_DOMAIN>`.
 * Без `TLS_ASK_TOKEN` проверка выключена (404): не открытый сервис «есть ли такой домен». Статусы: 200 — можно, 404 — нет, 403 — неверный токен.
 */
export function tlsAskDecision(domain: string | null, token: string | null, env: AskEnv): 200 | 403 | 404 {
  if (!env.TLS_ASK_TOKEN) return 404;
  if (!tokenMatches(token, env.TLS_ASK_TOKEN)) return 403;
  const name = (domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME.test(name)) return 404;
  return tenantForHost(name, { TENANT_BASE_DOMAIN: env.TENANT_BASE_DOMAIN }) ? 200 : 404;
}
