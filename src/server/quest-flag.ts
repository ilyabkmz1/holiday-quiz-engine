import { isForceOpenAllowed } from "@/server/env";

type RawEnv = Record<string, string | undefined>;

/**
 * Открыт ли прототип `/quest`. Вне production — всегда; в production — только при явном
 * `QUEST_PROTOTYPE=true` (стенд для показа) или в локальном контуре с QUIZ_FORCE_OPEN
 * (те же правила, что у принудительного открытия квиза). Окно кампании и остальные правила
 * открытия проверяет тот же API сессий.
 */
export function isQuestEnabled(env: RawEnv = process.env): boolean {
  const nodeEnv = env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
  if (nodeEnv !== "production") return true;
  if (env.QUEST_PROTOTYPE === "true") return true;
  let appUrl = "http://invalid.example";
  try {
    appUrl = new URL(env.APP_URL ?? appUrl).toString();
  } catch {
    // Некорректный адрес: локальный контур не подтверждается.
  }
  return isForceOpenAllowed({
    NODE_ENV: nodeEnv,
    APP_URL: appUrl,
    QUIZ_FORCE_OPEN: env.QUIZ_FORCE_OPEN === "true",
    QUIZ_LOCAL_STACK: env.QUIZ_LOCAL_STACK === "true"
  });
}
