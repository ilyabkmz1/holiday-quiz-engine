import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildStartParam, parseStartParam } from "@/platform/start-param";
import { miniAppLink, telegramShareLink } from "@/platform/telegram-links";
import { signTelegramInitData, TelegramInitDataError, verifyTelegramInitData } from "@/platform/telegram-init-data";
import { subjectHash, telegramBotToken } from "@/server/telegram-config";

const TOKEN = "123456789:TEST-token-only-for-unit-tests_0000000";
const NOW = new Date("2026-12-21T09:00:00Z");
const authDate = (offsetSeconds = 0) => String(Math.floor(NOW.getTime() / 1000) + offsetSeconds);
const user = (id = 4242) => JSON.stringify({ id, first_name: "Имя", username: "someone", language_code: "ru" });
const MAX_AGE = 24 * 3600;

function reason(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof TelegramInitDataError) return error.reason;
    throw error;
  }
  return "ok";
}

describe("verifyTelegramInitData", () => {
  it("принимает валидную подпись и отдаёт идентификатор, параметр запуска и время", () => {
    const initData = signTelegramInitData({ auth_date: authDate(-30), query_id: "AAH", start_param: "d6_s_channel", user: user() }, TOKEN);
    const result = verifyTelegramInitData(initData, TOKEN, NOW, MAX_AGE);
    expect(result).toEqual({ userId: "4242", startParam: "d6_s_channel", authDate: new Date((Math.floor(NOW.getTime() / 1000) - 30) * 1000) });
  });

  it("совпадает с независимой реализацией алгоритма из документации (эталонный расчёт HMAC)", () => {
    const fields = { auth_date: authDate(-5), user: user(77), chat_type: "private", chat_instance: "123" };
    const check = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
    const hash = createHmac("sha256", secret).update(check).digest("hex");
    const initData = new URLSearchParams({ ...fields, hash }).toString();
    expect(verifyTelegramInitData(initData, TOKEN, NOW, MAX_AGE).userId).toBe("77");
  });

  it("поле signature (Ed25519 для третьих сторон) входит в проверку HMAC как обычное поле", () => {
    const initData = signTelegramInitData({ auth_date: authDate(), user: user(), signature: "dGVzdC1zaWduYXR1cmUtbm90LXZlcmlmaWVk" }, TOKEN);
    expect(verifyTelegramInitData(initData, TOKEN, NOW, MAX_AGE).userId).toBe("4242");
    // Если бы signature исключалась из строки проверки, эта подпись (посчитанная с ней) не сошлась бы.
    const params = new URLSearchParams(initData);
    params.set("signature", "другое-значение");
    expect(reason(() => verifyTelegramInitData(params.toString(), TOKEN, NOW, MAX_AGE))).toBe("bad_signature");
  });

  it("порядок полей в строке не важен: подпись считается по отсортированным ключам", () => {
    const initData = signTelegramInitData({ auth_date: authDate(), user: user(), query_id: "q", start_param: "d1" }, TOKEN);
    const shuffled = [...new URLSearchParams(initData).entries()].reverse();
    expect(verifyTelegramInitData(new URLSearchParams(shuffled).toString(), TOKEN, NOW, MAX_AGE).userId).toBe("4242");
  });

  it("отклоняет подпись чужого токена", () => {
    const initData = signTelegramInitData({ auth_date: authDate(), user: user() }, TOKEN);
    expect(reason(() => verifyTelegramInitData(initData, "999:other-bot-token", NOW, MAX_AGE))).toBe("bad_signature");
  });

  it.each(["user", "auth_date", "start_param", "query_id"])("отклоняет подмену поля %s", (field) => {
    const initData = signTelegramInitData({ auth_date: authDate(), user: user(1), start_param: "d2", query_id: "q" }, TOKEN);
    const params = new URLSearchParams(initData);
    params.set(field, field === "user" ? user(2) : field === "auth_date" ? authDate(5) : "d3");
    expect(reason(() => verifyTelegramInitData(params.toString(), TOKEN, NOW, MAX_AGE))).toBe("bad_signature");
  });

  it("отклоняет добавленное и удалённое поле", () => {
    const initData = signTelegramInitData({ auth_date: authDate(), user: user() }, TOKEN);
    expect(reason(() => verifyTelegramInitData(`${initData}&start_param=d1`, TOKEN, NOW, MAX_AGE))).toBe("bad_signature");
    const params = new URLSearchParams(initData);
    params.delete("auth_date");
    expect(reason(() => verifyTelegramInitData(params.toString(), TOKEN, NOW, MAX_AGE))).toBe("bad_signature");
  });

  it("отклоняет повтор ключа: подпись и приложение могли бы прочитать разные значения", () => {
    const initData = signTelegramInitData({ auth_date: authDate(), user: user() }, TOKEN);
    expect(reason(() => verifyTelegramInitData(`${initData}&user=${encodeURIComponent(user(9))}`, TOKEN, NOW, MAX_AGE))).toBe("malformed");
  });

  it("просроченный auth_date — expired, на границе — ещё действует", () => {
    const old = signTelegramInitData({ auth_date: authDate(-MAX_AGE - 1), user: user() }, TOKEN);
    expect(reason(() => verifyTelegramInitData(old, TOKEN, NOW, MAX_AGE))).toBe("expired");
    const edge = signTelegramInitData({ auth_date: authDate(-MAX_AGE), user: user() }, TOKEN);
    expect(reason(() => verifyTelegramInitData(edge, TOKEN, NOW, MAX_AGE))).toBe("ok");
  });

  it("auth_date из будущего — future (запас на часы — минута)", () => {
    const later = signTelegramInitData({ auth_date: authDate(3600), user: user() }, TOKEN);
    expect(reason(() => verifyTelegramInitData(later, TOKEN, NOW, MAX_AGE))).toBe("future");
    const skew = signTelegramInitData({ auth_date: authDate(45), user: user() }, TOKEN);
    expect(reason(() => verifyTelegramInitData(skew, TOKEN, NOW, MAX_AGE))).toBe("ok");
  });

  it.each([
    ["пустая строка", ""],
    ["мусор", "это не initData"],
    ["без hash", `auth_date=${authDate()}&user=${encodeURIComponent(user())}`],
    ["hash не hex", `auth_date=${authDate()}&hash=zzzz`],
    ["hash короткий", `auth_date=${authDate()}&hash=abcd`],
    ["огромная строка", `a=${"x".repeat(20_000)}&hash=${"a".repeat(64)}`]
  ])("мусор: %s — отказ без исключений другого рода", (_name, initData) => {
    expect(["malformed", "bad_signature"]).toContain(reason(() => verifyTelegramInitData(initData, TOKEN, NOW, MAX_AGE)));
  });

  it("пустой токен бота отклоняется", () => {
    const initData = signTelegramInitData({ auth_date: authDate(), user: user() }, TOKEN);
    expect(reason(() => verifyTelegramInitData(initData, "", NOW, MAX_AGE))).toBe("malformed");
  });

  it("верная подпись, но нет пользователя или нечисловой id — no_user/malformed", () => {
    expect(reason(() => verifyTelegramInitData(signTelegramInitData({ auth_date: authDate() }, TOKEN), TOKEN, NOW, MAX_AGE))).toBe("no_user");
    expect(reason(() => verifyTelegramInitData(signTelegramInitData({ auth_date: authDate(), user: JSON.stringify({ id: "abc" }) }, TOKEN), TOKEN, NOW, MAX_AGE))).toBe("no_user");
    expect(reason(() => verifyTelegramInitData(signTelegramInitData({ auth_date: authDate(), user: "{не json" }, TOKEN), TOKEN, NOW, MAX_AGE))).toBe("no_user");
    expect(reason(() => verifyTelegramInitData(signTelegramInitData({ auth_date: "не число", user: user() }, TOKEN), TOKEN, NOW, MAX_AGE))).toBe("malformed");
  });

  it("start_param вне допустимого алфавита отбрасывается", () => {
    const initData = signTelegramInitData({ auth_date: authDate(), user: user(), start_param: "d6 & rm" }, TOKEN);
    expect(verifyTelegramInitData(initData, TOKEN, NOW, MAX_AGE).startParam).toBeNull();
  });

  it("сообщение об ошибке не содержит токена и initData", () => {
    const initData = signTelegramInitData({ auth_date: authDate(), user: user() }, TOKEN);
    try {
      verifyTelegramInitData(initData, "999:other", NOW, MAX_AGE);
    } catch (error) {
      expect(String(error)).not.toContain("999:other");
      expect(String(error)).not.toContain(initData);
    }
  });
});

describe("parseStartParam / buildStartParam", () => {
  it.each([
    ["d6", { day: 6, source: null }],
    ["d12", { day: 12, source: null }],
    ["s_channel", { day: null, source: "channel" }],
    ["d6_s_channel", { day: 6, source: "channel" }],
    ["d6_s_Chat-2", { day: 6, source: "chat-2" }],
    ["d0", { day: null, source: null }],
    ["d123", { day: null, source: null }],
    ["x6", { day: null, source: null }],
    ["d6_s_", { day: null, source: null }],
    ["d6_s_a_b", { day: null, source: null }],
    ["d6 s_a", { day: null, source: null }],
    ["", { day: null, source: null }]
  ])("%s", (raw, expected) => {
    expect(parseStartParam(raw)).toEqual(expected);
  });

  it("пустое и слишком длинное значение — пустой результат", () => {
    expect(parseStartParam(null)).toEqual({ day: null, source: null });
    expect(parseStartParam(undefined)).toEqual({ day: null, source: null });
    expect(parseStartParam(`s_${"a".repeat(600)}`)).toEqual({ day: null, source: null });
  });

  it("собирается обратно и проверяет вход", () => {
    expect(buildStartParam({ day: 6, source: "channel" })).toBe("d6_s_channel");
    expect(buildStartParam({ day: 6 })).toBe("d6");
    expect(buildStartParam({ source: "chat" })).toBe("s_chat");
    expect(buildStartParam({})).toBeNull();
    expect(parseStartParam(buildStartParam({ day: 31, source: "a-b" }))).toEqual({ day: 31, source: "a-b" });
    expect(() => buildStartParam({ day: 0 })).toThrow();
    expect(() => buildStartParam({ source: "Плохо_" })).toThrow();
  });
});

describe("ссылки и токены", () => {
  const app = { botUsername: "zerno_bot", appShortName: "advent" };

  it("прямая ссылка на мини-приложение, день и компактный режим", () => {
    expect(miniAppLink(app)).toBe("https://t.me/zerno_bot/advent");
    expect(miniAppLink(app, { day: 6, source: "channel" })).toBe("https://t.me/zerno_bot/advent?startapp=d6_s_channel");
    expect(miniAppLink(app, { compact: true })).toBe("https://t.me/zerno_bot/advent?mode=compact");
  });

  it("окно «Переслать» кодирует ссылку и текст", () => {
    const link = new URL(telegramShareLink(miniAppLink(app, { source: "share" }), "Привет & пока"));
    expect(link.origin + link.pathname).toBe("https://t.me/share/url");
    expect(link.searchParams.get("url")).toBe("https://t.me/zerno_bot/advent?startapp=s_share");
    expect(link.searchParams.get("text")).toBe("Привет & пока");
  });

  it("токен бота: свой бот клиента важнее общего; без обоих — undefined", () => {
    expect(telegramBotToken("Zerno_Bot", { TELEGRAM_BOT_TOKEN: "common", TELEGRAM_BOT_TOKEN__ZERNO_BOT: "own" })).toBe("own");
    expect(telegramBotToken("zerno_bot", { TELEGRAM_BOT_TOKEN: "common" })).toBe("common");
    expect(telegramBotToken("zerno_bot", {})).toBeUndefined();
  });

  it("псевдоним: стабилен, зависит от секрета, кампании и пользователя, сырого id в нём нет", () => {
    const secret = "s".repeat(32);
    const a = subjectHash("telegram", "campaign-a", "4242", secret);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(subjectHash("telegram", "campaign-a", "4242", secret));
    expect(a).not.toBe(subjectHash("telegram", "campaign-b", "4242", secret));
    expect(a).not.toBe(subjectHash("telegram", "campaign-a", "4243", secret));
    expect(a).not.toBe(subjectHash("telegram", "campaign-a", "4242", "t".repeat(32)));
    expect(a).not.toContain("4242");
  });
});
