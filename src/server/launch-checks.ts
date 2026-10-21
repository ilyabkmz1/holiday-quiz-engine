import { hasLegalPlaceholder, type LegalConfig } from "@/config/legal";
import { isPreviewEnvironment, type RuntimeEnv } from "@/server/env";
import { DEV_QR_SECRET } from "@/server/services/reward-service";

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

/**
 * Секрет подписи QR и зерна удачи для RewardService: `REWARD_QR_SECRET`, а на закрытом стенде и в локальном контуре
 * (там образ собран с NODE_ENV=production) — ключ разработки, как обещает assertRewardSecrets. В боевом запуске без
 * секрета — `undefined`: QR не выдаётся, зерно удачи случайное.
 */
export function resolveRewardSecret(env: RewardSecretEnv): string | undefined {
  return env.REWARD_QR_SECRET || (isPreviewEnvironment(env) ? DEV_QR_SECRET : undefined);
}

type TelegramLaunchEnv = LaunchEnv & Partial<Pick<RuntimeEnv, "PLATFORM_ID_SECRET">>;

/**
 * Если в пакете включён Telegram, боевому запуску нужны токен бота (`TELEGRAM_BOT_TOKEN` или `TELEGRAM_BOT_TOKEN__<БОТ>`) и
 * `PLATFORM_ID_SECRET`: без них вход из Telegram не заработает. На стенде и локально — только предупреждение в `quiz:check`.
 */
export function assertTelegramSecrets(env: TelegramLaunchEnv, telegram: { botUsername: string } | undefined, tenant?: string, source: Record<string, string | undefined> = process.env): void {
  if (!telegram || isPreviewEnvironment(env)) return;
  const token = source[`TELEGRAM_BOT_TOKEN__${telegram.botUsername.toUpperCase()}`] || source.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error(`Адвент${tenant ? ` «${tenant}»` : ""}: включён Telegram, задайте TELEGRAM_BOT_TOKEN (или TELEGRAM_BOT_TOKEN__${telegram.botUsername.toUpperCase()})`);
  }
  if (!env.PLATFORM_ID_SECRET) {
    throw new Error(`Адвент${tenant ? ` «${tenant}»` : ""}: включён Telegram, задайте PLATFORM_ID_SECRET (не короче 32 символов, openssl rand -hex 32)`);
  }
}
