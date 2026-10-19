// Вызывается один раз при старте сервера Next.js. Проверяем окружение сразу, а не на первом запросе:
// неверная конфигурация (например, QUIZ_FORCE_OPEN в production без staging-паролей) останавливает
// процесс при запуске, и выкатка видит это по healthcheck, а не по ошибкам игроков.
export async function register() {
  // Сборка идёт с заглушками окружения; проверяем только реальный запуск сервера.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { getRuntimeEnv } = await import("@/server/env");
  const { assertLaunchReady } = await import("@/server/launch-checks");
  const { activeTenants, assertTenantsConfigured, tenantCore } = await import("@/server/tenants");
  assertTenantsConfigured();
  // Юридические тексты проверяются у каждого пакета, который этот процесс может показать.
  for (const tenant of activeTenants()) assertLaunchReady(getRuntimeEnv(), tenantCore(tenant).legal, tenant.tenant);
}
