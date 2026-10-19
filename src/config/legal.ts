/**
 * Маркер текста, который ещё не утвердил юрист. В production запуск с ним запрещён
 * (см. `assertLaunchReady` в src/server/launch-checks.ts), на staging и в разработке он допустим.
 */
export const LEGAL_PLACEHOLDER = "[ТЕКСТ НА СОГЛАСОВАНИИ ЮРИСТА]";

/** Юридические тексты кампании. Абзацы `policyText` разделяются пустой строкой. Валидирует их `campaignSchema` (поле `legal`). */
export type LegalConfig = {
  operatorName: string;
  policyText: string;
  consentText: string;
};

/** Остался ли в юридических текстах маркер «на согласовании». */
export function hasLegalPlaceholder(legal: LegalConfig): boolean {
  return Object.values(legal).some((value) => value.includes(LEGAL_PLACEHOLDER));
}

// Модуль безопасен для клиентского бандла: простые константы, без zod и схемы кампании (не импортируйте сюда schema.ts).
