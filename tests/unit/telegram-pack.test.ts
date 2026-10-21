import { afterEach, describe, expect, it, vi } from "vitest";

import { adventPackSchema } from "@/config/pack";
import { assertTelegramSecrets } from "@/server/launch-checks";
import { checkPack } from "@/tools/pack-check";

import { adventPackFixture } from "../fixtures/advent";

const telegram = { botUsername: "zerno_advent_bot", appShortName: "advent" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const withTelegram = (extra: Record<string, unknown> = {}): Record<string, any> => ({ ...adventPackFixture(), platforms: { telegram: { ...telegram, ...extra } } });

afterEach(() => vi.unstubAllEnvs());

describe("пакет: platforms.telegram", () => {
  it("без platforms Telegram выключен", () => {
    expect(adventPackSchema.parse(adventPackFixture()).platforms).toEqual({});
  });

  it("принимает имена бота и приложения", () => {
    expect(adventPackSchema.parse(withTelegram()).platforms.telegram).toEqual(telegram);
    expect(adventPackSchema.parse(withTelegram({ botUsername: "Zerno_Bot" })).platforms.telegram?.botUsername).toBe("Zerno_Bot");
  });

  it.each([
    ["без суффикса bot", { botUsername: "zerno_advent" }],
    ["с @", { botUsername: "@zerno_advent_bot" }],
    ["короткое имя бота", { botUsername: "bot" }],
    ["пробел", { botUsername: "zerno advent bot" }],
    ["кириллица", { botUsername: "зерно_bot" }],
    ["имя приложения с дефисом", { appShortName: "my-app" }],
    ["имя приложения короче трёх", { appShortName: "ab" }],
    ["имя приложения с цифры не нужно: пусто", { appShortName: "" }]
  ])("отклоняет: %s", (_name, extra) => {
    expect(adventPackSchema.safeParse(withTelegram(extra)).success).toBe(false);
  });
});

describe("quiz:check для Telegram", () => {
  it("предупреждает, если в окружении нет токена бота и секрета, и если нет своего текста согласия", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN__ZERNO_ADVENT_BOT", "");
    vi.stubEnv("PLATFORM_ID_SECRET", "");
    const report = await checkPack(withTelegram());
    expect(report.errors).toEqual([]);
    const text = report.warnings.join("\n");
    expect(text).toContain("токена бота");
    expect(text).toContain("PLATFORM_ID_SECRET");
    expect(text).toContain("telegramConsentText");
  });

  it("с токеном и секретом в окружении предупреждений про них нет", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN__ZERNO_ADVENT_BOT", "1:token");
    vi.stubEnv("PLATFORM_ID_SECRET", "x".repeat(32));
    const text = (await checkPack(withTelegram())).warnings.join("\n");
    expect(text).not.toContain("токена бота");
    expect(text).not.toContain("PLATFORM_ID_SECRET");
  });

  it("hosts только localhost — предупреждение про публичный HTTPS", async () => {
    const pack = withTelegram();
    pack.hosts = ["advent.localhost:3000"];
    expect((await checkPack(pack)).warnings.join("\n")).toContain("публичный HTTPS");
  });

  it("пакет без Telegram не получает предупреждений про него", async () => {
    expect((await checkPack(adventPackFixture())).warnings.join("\n")).not.toContain("platforms.telegram");
  });
});

describe("запуск: токен и секрет обязательны в боевом режиме", () => {
  const prod = { APP_URL: "https://advent.example.org", NODE_ENV: "production" as const, QUIZ_LOCAL_STACK: false };

  it("без Telegram в пакете ничего не требуется", () => {
    expect(() => assertTelegramSecrets(prod, undefined, "t", {})).not.toThrow();
  });

  it("production: нужен токен бота (общий или бота клиента) и PLATFORM_ID_SECRET", () => {
    expect(() => assertTelegramSecrets({ ...prod, PLATFORM_ID_SECRET: "x".repeat(32) }, telegram, "t", {})).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => assertTelegramSecrets(prod, telegram, "t", { TELEGRAM_BOT_TOKEN: "1:t" })).toThrow(/PLATFORM_ID_SECRET/);
    expect(() => assertTelegramSecrets({ ...prod, PLATFORM_ID_SECRET: "x".repeat(32) }, telegram, "t", { TELEGRAM_BOT_TOKEN__ZERNO_ADVENT_BOT: "1:t" })).not.toThrow();
  });

  it("закрытый стенд и локальный контур — без требований", () => {
    expect(() => assertTelegramSecrets({ ...prod, STAGING_USERNAME: "u", STAGING_PASSWORD: "p".repeat(16) }, telegram, "t", {})).not.toThrow();
    expect(() => assertTelegramSecrets({ ...prod, NODE_ENV: "development" }, telegram, "t", {})).not.toThrow();
  });
});
