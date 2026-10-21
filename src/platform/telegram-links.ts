import { buildStartParam } from "@/platform/start-param";

export type TelegramAppRef = { botUsername: string; appShortName: string };

/** Прямая ссылка на мини-приложение: `https://t.me/<бот>/<приложение>?startapp=…`; `compact` — половина экрана. */
export function miniAppLink(app: TelegramAppRef, options: { day?: number | null; source?: string | null; compact?: boolean } = {}): string {
  const url = new URL(`https://t.me/${app.botUsername}/${app.appShortName}`);
  const start = buildStartParam(options);
  if (start) url.searchParams.set("startapp", start);
  if (options.compact) url.searchParams.set("mode", "compact");
  return url.toString();
}

/** Окно «Переслать» в Telegram со ссылкой и текстом. */
export function telegramShareLink(url: string, text: string): string {
  const share = new URL("https://t.me/share/url");
  share.searchParams.set("url", url);
  share.searchParams.set("text", text);
  return share.toString();
}
