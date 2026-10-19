import { hasLegalPlaceholder, type LegalConfig } from "@/config/legal";
import { isPreviewEnvironment, type RuntimeEnv } from "@/server/env";

type LaunchEnv = Pick<RuntimeEnv, "APP_URL" | "NODE_ENV" | "QUIZ_LOCAL_STACK"> &
  Partial<Pick<RuntimeEnv, "STAGING_USERNAME" | "STAGING_PASSWORD">>;

/**
 * Проверка перед боевым запуском: юридические тексты не должны быть черновиком.
 * На staging, в локальном контуре и вне production маркер допустим. Бросает при старте процесса
 * (src/instrumentation.ts), поэтому выкатка видит сбой по healthcheck, а игроки черновика не увидят.
 */
export function assertLaunchReady(env: LaunchEnv, legal: LegalConfig, tenant?: string): void {
  if (isPreviewEnvironment(env)) return;
  if (hasLegalPlaceholder(legal)) {
    throw new Error(
      `Юридические тексты кампании${tenant ? ` «${tenant}»` : ""} (campaign.legal) содержат маркер «на согласовании юриста»: ` +
        "в production замените политику и согласие утверждённой редакцией (tenants/<пакет>/legal.ts)"
    );
  }
}
