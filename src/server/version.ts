/** Версия сборки (git commit sha), которую CI/Docker передаёт через APP_VERSION; по умолчанию `dev`. */
export function appVersion(env: Record<string, string | undefined> = process.env): string {
  const value = env.APP_VERSION?.trim();
  return value ? value : "dev";
}
