import { z } from "zod";

// Пустая строка в Compose (`${VAR:-}`) означает «не задано».
const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());

const runtimeEnvBase = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: z.string().optional().transform((value) => value === "true"),
  SMTP_FROM: z.string().min(1),
  // Необязательная SMTP-авторизация (боевой SMTP). Обе переменные задаются вместе.
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(16),
  // Закрытый стенд (показ до старта кампании): весь сайт под HTTP Basic auth, см. src/server/staging-gate.ts.
  // Обе переменные задаются вместе; пароль не короче 16 символов.
  STAGING_USERNAME: optionalString,
  STAGING_PASSWORD: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(16).optional()),
  QUIZ_FORCE_OPEN: z.string().optional().transform((value) => value === "true"),
  // Standalone-сервер Next принудительно ставит NODE_ENV=production, поэтому Docker Compose
  // (локальный и CI-контур) не может выглядеть «не-production» через NODE_ENV.
  // Маркер разрешает QUIZ_FORCE_OPEN в production только при loopback-адресе в APP_URL.
  QUIZ_LOCAL_STACK: z.string().optional().transform((value) => value === "true"),
  // Мультиарендность (этап 1 движка): slug пакета из tenants/ для однопользовательского режима и общий домен для <slug>.<домен>.
  TENANT: optionalString,
  TENANT_BASE_DOMAIN: optionalString,
  // Администратор процесса (ADMIN_USERNAME/ADMIN_PASSWORD) в многоарендном режиме без TENANT: только явно, см. src/server/admin-auth.ts.
  SUPERADMIN: z.string().optional().transform((value) => value === "true"),
  // Секрет для проверки Caddy перед выпуском сертификата (on-demand TLS): /api/internal/tls-ask?domain=…&token=…
  TLS_ASK_TOKEN: optionalString,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

const runtimeEnvSchema = runtimeEnvBase.superRefine((env, ctx) => {
  if (Boolean(env.STAGING_USERNAME) !== Boolean(env.STAGING_PASSWORD)) {
    ctx.addIssue({ code: "custom", path: ["STAGING_PASSWORD"], message: "STAGING_USERNAME and STAGING_PASSWORD must be set together" });
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
    ctx.addIssue({ code: "custom", path: ["SMTP_PASSWORD"], message: "SMTP_USER and SMTP_PASSWORD must be set together" });
  }
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;

type ForceOpenEnv = Pick<RuntimeEnv, "APP_URL" | "QUIZ_FORCE_OPEN" | "QUIZ_LOCAL_STACK" | "NODE_ENV"> &
  Partial<Pick<RuntimeEnv, "STAGING_USERNAME" | "STAGING_PASSWORD">>;

/** Включён ли закрытый стенд: заданы оба staging-креденшела. */
export function isStagingEnabled(env: Partial<Pick<RuntimeEnv, "STAGING_USERNAME" | "STAGING_PASSWORD">>): boolean {
  return Boolean(env.STAGING_USERNAME && env.STAGING_PASSWORD);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hasLoopbackAppUrl(env: Pick<RuntimeEnv, "APP_URL">): boolean {
  return LOOPBACK_HOSTS.has(new URL(env.APP_URL).hostname);
}

function usesLocalStackBypass(env: ForceOpenEnv): boolean {
  return env.NODE_ENV === "production" && env.QUIZ_FORCE_OPEN && env.QUIZ_LOCAL_STACK && hasLoopbackAppUrl(env);
}

/**
 * Действует ли QUIZ_FORCE_OPEN. Вне production флаг работает как есть. В production —
 * только когда сайт гарантированно не публичный: либо локальный контур (QUIZ_LOCAL_STACK=true
 * и APP_URL на loopback-адресе), либо заданы оба staging-креденшела (весь сайт закрыт Basic auth).
 * Реальный production с публичным APP_URL и без staging-пароля так открыть нельзя.
 */
export function isForceOpenAllowed(env: ForceOpenEnv): boolean {
  if (!env.QUIZ_FORCE_OPEN) return false;
  if (env.NODE_ENV !== "production") return true;
  return isStagingEnabled(env) || usesLocalStackBypass(env);
}

/**
 * Не боевой запуск: вне production, закрытый стенд (staging) или локальный контур.
 * Здесь допустимы черновые тексты и открытые флаги; настоящий production — всё остальное.
 */
export function isPreviewEnvironment(env: Omit<ForceOpenEnv, "QUIZ_FORCE_OPEN">): boolean {
  return env.NODE_ENV !== "production" || isStagingEnabled(env) || (env.QUIZ_LOCAL_STACK && hasLoopbackAppUrl(env));
}

let cached: RuntimeEnv | undefined;

// Proxy и route handlers собираются в разные бандлы, поэтому флаг живёт в globalThis:
// предупреждение о staging-режиме пишется один раз на процесс.
const STAGING_WARNED = Symbol.for("quiz.stagingWarned");
type WarnFlag = { [STAGING_WARNED]?: boolean };

export function resetRuntimeEnvCache(): void {
  cached = undefined;
  delete (globalThis as WarnFlag)[STAGING_WARNED];
}

export function getRuntimeEnv(): RuntimeEnv {
  if (!cached) {
    const parsed = runtimeEnvSchema.parse(process.env);
    if (parsed.QUIZ_FORCE_OPEN && !isForceOpenAllowed(parsed)) {
      throw new Error(
        parsed.QUIZ_LOCAL_STACK
          ? "QUIZ_FORCE_OPEN cannot be enabled in production: QUIZ_LOCAL_STACK requires a loopback APP_URL (or set STAGING_USERNAME and STAGING_PASSWORD)"
          : "QUIZ_FORCE_OPEN cannot be enabled in production without STAGING_USERNAME and STAGING_PASSWORD"
      );
    }
    if (isStagingEnabled(parsed) && !(globalThis as WarnFlag)[STAGING_WARNED]) {
      (globalThis as WarnFlag)[STAGING_WARNED] = true;
      console.warn(
        JSON.stringify({
          event: "staging_mode_enabled",
          appHost: new URL(parsed.APP_URL).hostname,
          forceOpen: parsed.QUIZ_FORCE_OPEN,
          note: "весь сайт закрыт HTTP Basic auth; не использовать для боевой кампании"
        })
      );
    }
    if (usesLocalStackBypass(parsed)) {
      console.warn(JSON.stringify({ event: "force_open_local_stack", appHost: new URL(parsed.APP_URL).hostname }));
    }
    cached = parsed;
  }
  return cached;
}
