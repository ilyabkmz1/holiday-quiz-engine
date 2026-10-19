/**
 * Маркер незаполненного места в пакете (квиз и адвент) как отдельное слово: «TODO: …» — да, «MASTODON», «XXXL-1»
 * и `todo-list` — нет (юникодные границы, чтобы работала и кириллица).
 */
export const MARKER = /(?<![\p{L}\p{N}_])(?:TODO|FIXME|XXX|ЗАПОЛНИТЬ)(?![\p{L}\p{N}_])/u;

/**
 * Поля, которые не читает игрок: идентификаторы, ссылки на файлы и перечисления. Маркер в них — не «незаполненный текст»
 * (например, id комнаты `todo-room`), поэтому проверки пакетов их не просматривают.
 */
export const NON_TEXT_KEY =
  /(?:^|[a-z])(?:id|Id|Ids)$|^(?:slug|tenant|hosts|icon|color|font|type|mode|logo|ogBackground|pageArt|correctOrder)$/;

/** Текстовые строки объекта с путями — для поиска маркеров незаполненных мест и стоп-слов. Нетекстовые поля пропускаются. */
export function walkStrings(value: unknown, trail: string, visit: (path: string, text: string) => void, key = ""): void {
  if (typeof value === "string") {
    if (!NON_TEXT_KEY.test(key)) visit(trail, value);
  } else if (Array.isArray(value)) value.forEach((item, index) => walkStrings(item, `${trail}[${index}]`, visit, key));
  else if (value && typeof value === "object") {
    for (const [childKey, item] of Object.entries(value)) walkStrings(item, trail ? `${trail}.${childKey}` : childKey, visit, childKey);
  }
}
