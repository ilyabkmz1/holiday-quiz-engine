import { randomBytes } from "node:crypto";

export const TEST_APP_URL = "http://quiz.test";
export const TEST_ADMIN_USERNAME = "operator";
// Генерируется на каждый прогон: в репозитории нет ни одного значения, похожего на настоящий секрет.
export const TEST_ADMIN_PASSWORD = `adm-${randomBytes(12).toString("hex")}`;

/** Момент внутри окна кампании (20–31 декабря 2026, Москва). */
export const OPEN_NOW = new Date("2026-12-24T12:00:00Z");
/** До старта кампании. */
export const UPCOMING_NOW = new Date("2026-12-01T12:00:00Z");
