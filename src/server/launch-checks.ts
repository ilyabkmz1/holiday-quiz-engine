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

type RewardSecretEnv = LaunchEnv & Partial<Pick<RuntimeEnv, "REWARD_QR_SECRET">>;

/**
 * Награды адвента, которые гасятся на кассе по личному QR, требуют секрета подписи `REWARD_QR_SECRET`.
 * В боевом запуске без него процесс не стартует; на staging, в локальном контуре и вне production допустим запасной
 * ключ разработки. Принимает пакет адвента (`advent.rewards`) или любой список наград.
 */
export function assertRewardSecrets(env: RewardSecretEnv, rewards: ReadonlyArray<{ redeem: string }>, tenant?: string): void {
  if (isPreviewEnvironment(env)) return;
  if (rewards.some((reward) => reward.redeem === "cashier" || reward.redeem === "both") && !env.REWARD_QR_SECRET) {
    throw new Error(
      `Адвент${tenant ? ` «${tenant}»` : ""} гасит награды на кассе по личному QR: задайте REWARD_QR_SECRET (не короче 32 символов, openssl rand -hex 32)`
    );
  }
}
