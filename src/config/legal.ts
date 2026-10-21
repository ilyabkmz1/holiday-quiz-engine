/**
 * Маркер текста, который ещё не утвердил юрист. В production запуск с ним запрещён
 * (см. `assertLaunchReady` в src/server/launch-checks.ts), на staging и в разработке он допустим.
 */
export const LEGAL_PLACEHOLDER = "[ТЕКСТ НА СОГЛАСОВАНИИ ЮРИСТА]";

/** Юридические тексты кампании. Абзацы `policyText` разделяются пустой строкой. Валидирует их `campaignSchema` (поле `legal`). */
export type LegalConfig = {
  operatorName: string;
  operatorDetails?: string;
  policyText: string;
  consentText: string;
  /** Согласие на рекламную и информационную рассылку (ст. 18 38-ФЗ): текст отметки «напоминания на почту»; `{operator}` — `operatorName`. */
  marketingConsentText?: string;
  /** Согласие для входа через Telegram; без него на экране согласия показывается `consentText`. */
  telegramConsentText?: string;
};

/** Текст согласия на рассылку по умолчанию; `quiz:check` при `reminders.channel = email` требует задать свой (`legal.marketingConsentText`). */
export const DEFAULT_MARKETING_CONSENT_TEXT = "Согласен(на) получать напоминания о новых днях адвента и рекламные рассылки от {operator}";

/** Текст отметки согласия на рассылку с подставленным оператором. */
export function marketingConsentText(legal: Pick<LegalConfig, "operatorName" | "marketingConsentText">): string {
  return (legal.marketingConsentText ?? DEFAULT_MARKETING_CONSENT_TEXT).replaceAll("{operator}", legal.operatorName);
}

/** Остался ли в юридических текстах маркер «на согласовании». */
export function hasLegalPlaceholder(legal: LegalConfig): boolean {
  return Object.values(legal).some((value) => typeof value === "string" && value.includes(LEGAL_PLACEHOLDER));
}

// Модуль безопасен для клиентского бандла: простые константы, без zod и схемы кампании (не импортируйте сюда schema.ts).
