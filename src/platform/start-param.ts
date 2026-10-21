/**
 * Параметр запуска мини-приложения (`startapp` в прямой ссылке, `start_param` в initData). Telegram пропускает только
 * `A-Za-z0-9_-` и до 512 символов. Наш формат: `d<день>` — открыть день, `s_<метка>` — источник перехода, вместе — `d6_s_channel`.
 */
export type StartParam = { day: number | null; source: string | null };

/** Допустимое значение параметра по правилам Telegram. */
export const START_PARAM_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

/** Метка источника: латиница, цифры и дефис (подчёркивание — разделитель частей), до 24 символов. */
export const SOURCE_PATTERN = /^[a-z0-9-]{1,24}$/;

const FORMAT = /^(?:d(\d{1,2}))?(?:_?s_([A-Za-z0-9-]{1,24}))?$/;

const EMPTY: StartParam = { day: null, source: null };

/** Разбор параметра. Мусор и неизвестный формат дают пустой результат, а не ошибку: ссылку мог написать кто угодно. */
export function parseStartParam(raw: string | null | undefined): StartParam {
  if (!raw || !START_PARAM_PATTERN.test(raw)) return EMPTY;
  const match = FORMAT.exec(raw);
  if (!match) return EMPTY;
  const day = match[1] === undefined ? null : Number(match[1]);
  const source = match[2] === undefined ? null : match[2].toLowerCase();
  return { day: day !== null && day >= 1 ? day : null, source: source !== null && SOURCE_PATTERN.test(source) ? source : null };
}

/** Собирает параметр запуска; пустой набор — `null` (ссылка без `startapp`). */
export function buildStartParam({ day, source }: { day?: number | null; source?: string | null }): string | null {
  const parts: string[] = [];
  if (day !== undefined && day !== null) {
    if (!Number.isInteger(day) || day < 1 || day > 99) throw new Error(`День ссылки вне диапазона: ${day}`);
    parts.push(`d${day}`);
  }
  if (source) {
    if (!SOURCE_PATTERN.test(source)) throw new Error(`Метка источника «${source}»: латиница, цифры и дефис, до 24 символов`);
    parts.push(`s_${source}`);
  }
  return parts.length > 0 ? parts.join("_") : null;
}
