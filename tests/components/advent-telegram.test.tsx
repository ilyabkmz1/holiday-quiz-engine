// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdventGame } from "@/components/advent/AdventGame";
import { createTelegramBridge, detectPlatform, loadTelegramWebApp, WEB_BRIDGE, type TelegramWebApp } from "@/platform/telegram-webapp";
import type { PublicAdvent } from "@/types/advent";

import { at } from "../support/advent";
import { memoryAdventApi } from "../support/advent-client";
import { config, mockReducedMotion, publicConfig } from "../support/advent-ui";
import { snowGlobe } from "../support/world";

const advent: PublicAdvent = { ...publicConfig, platforms: { telegram: { botUsername: "zerno_advent_bot", appShortName: "advent" } } };
const copy = config.copy;

type Fake = TelegramWebApp & {
  backClicks: Array<() => void>;
  calls: string[];
  colors: Array<[string, string]>;
  haptics: string[];
  links: string[];
};

function fakeWebApp(overrides: Partial<TelegramWebApp> = {}): Fake {
  const fake: Fake = {
    initData: "auth_date=1&hash=x",
    initDataUnsafe: { start_param: undefined },
    version: "8.0",
    isVersionAtLeast: () => true,
    backClicks: [],
    calls: [],
    colors: [],
    haptics: [],
    links: [],
    ready: () => void fake.calls.push("ready"),
    expand: () => void fake.calls.push("expand"),
    setHeaderColor: (color) => void fake.colors.push(["header", color]),
    setBackgroundColor: (color) => void fake.colors.push(["background", color]),
    openTelegramLink: (url) => void fake.links.push(url),
    BackButton: {
      show: () => void fake.calls.push("back:show"),
      hide: () => void fake.calls.push("back:hide"),
      onClick: (callback) => void fake.backClicks.push(callback),
      offClick: (callback) => {
        fake.backClicks = fake.backClicks.filter((candidate) => candidate !== callback);
      }
    },
    HapticFeedback: {
      impactOccurred: (style) => void fake.haptics.push(`impact:${style}`),
      notificationOccurred: (type) => void fake.haptics.push(`notification:${type}`),
      selectionChanged: () => void fake.haptics.push("selection")
    },
    ...overrides
  };
  return fake;
}

beforeEach(() => {
  mockReducedMotion(false);
  window.history.replaceState(null, "", "/");
  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    // jsdom без хранилища.
  }
  delete window.Telegram;
  document.head.querySelectorAll("script[src*=telegram]").forEach((node) => node.remove());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.Telegram;
});

const door = (n: number) => document.querySelector<HTMLElement>(`[data-door="${n}"]`)!;

describe("платформа: определение и обёртка", () => {
  it("обычный веб: платформа web, скрипт Telegram не загружается, заглушки ничего не делают", async () => {
    expect(detectPlatform()).toBe("web");
    expect(WEB_BRIDGE.showBack(() => undefined)).toBeTypeOf("function");
    expect(() => {
      WEB_BRIDGE.ready();
      WEB_BRIDGE.expand();
      WEB_BRIDGE.haptic("success");
      WEB_BRIDGE.setColors({ header: "#000000", background: "#000000" });
    }).not.toThrow();
    expect(WEB_BRIDGE.openTelegramLink("https://t.me/x")).toBe(false);
    expect(document.querySelector("script[src*=telegram]")).toBeNull();
  });

  it("признаки Telegram: hash с данными запуска, ?platform=telegram, готовый window.Telegram.WebApp", () => {
    window.history.replaceState(null, "", "/#tgWebAppData=query_id%3D1&tgWebAppVersion=8.0");
    expect(detectPlatform()).toBe("telegram");
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/?platform=telegram");
    expect(detectPlatform()).toBe("telegram");
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    expect(detectPlatform()).toBe("web");
    window.Telegram = { WebApp: fakeWebApp() };
    expect(detectPlatform()).toBe("telegram");
  });

  it("признак переживает навигацию без hash (sessionStorage)", () => {
    window.history.replaceState(null, "", "/#tgWebAppPlatform=ios");
    expect(detectPlatform()).toBe("telegram");
    window.history.replaceState(null, "", "/");
    expect(detectPlatform()).toBe("telegram");
  });

  it("скрипт загружается один раз и только по запросу; готовый WebApp скрипт не требует", async () => {
    const fake = fakeWebApp();
    window.Telegram = { WebApp: fake };
    expect(await loadTelegramWebApp()).toBe(fake);
    expect(document.querySelector("script[src*=telegram]")).toBeNull();
    delete window.Telegram;
    const pending = loadTelegramWebApp(50);
    const script = document.querySelector<HTMLScriptElement>("script[src*=telegram]");
    expect(script?.src).toBe("https://telegram.org/js/telegram-web-app.js?64");
    script!.onerror?.(new Event("error"));
    expect(await pending).toBeNull();
  });

  it("обёртка: цвета только с 6.1, BackButton и тактильный отклик защищены от старых клиентов", () => {
    const old = fakeWebApp({ isVersionAtLeast: () => false });
    const bridge = createTelegramBridge(old);
    bridge.setColors({ header: "#101010", background: "#101010" });
    bridge.haptic("success");
    const off = bridge.showBack(() => undefined);
    off();
    expect(old.colors).toEqual([]);
    expect(old.haptics).toEqual([]);
    expect(old.calls).not.toContain("back:show");

    const modern = fakeWebApp();
    const next = createTelegramBridge(modern);
    next.setColors({ header: "#101010", background: "#202020" });
    next.haptic("open");
    next.haptic("success");
    next.haptic("tap");
    next.haptic("warning");
    expect(modern.colors).toEqual([["header", "#101010"], ["background", "#202020"]]);
    expect(modern.haptics).toEqual(["impact:medium", "notification:success", "selection", "notification:warning"]);
  });

  it("метод, бросающий исключение, не ломает игру", () => {
    const bridge = createTelegramBridge(fakeWebApp({ expand: () => { throw new Error("не поддерживается"); }, HapticFeedback: { impactOccurred: () => { throw new Error("x"); }, notificationOccurred: () => undefined, selectionChanged: () => undefined } }));
    expect(() => {
      bridge.expand();
      bridge.haptic("open");
    }).not.toThrow();
  });
});

describe("AdventGame в Telegram", () => {
  it("первый вход: экран согласия; без отметки участник не создаётся; с согласием — календарь без email-входа", async () => {
    const fake = fakeWebApp();
    window.Telegram = { WebApp: fake };
    const harness = memoryAdventApi({ start: at(3) });
    const create = vi.spyOn(harness.api, "createParticipant");
    render(<AdventGame advent={advent} world={snowGlobe} api={harness.api} />);

    expect(await screen.findByRole("heading", { level: 1, name: copy.telegramConsentTitle })).toBeInTheDocument();
    expect(screen.getByText(copy.telegramConsentNote)).toBeInTheDocument();
    expect(screen.getByText(advent.legal.consentText)).toBeInTheDocument();
    expect(fake.calls).toContain("ready");
    expect(fake.calls).toContain("expand");

    fireEvent.click(screen.getByRole("button", { name: copy.telegramConsentStart }));
    expect(await screen.findByText(copy.telegramConsentRequired)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: copy.telegramConsentStart }));
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(create).toHaveBeenCalledWith({ consent: true });
    expect(document.querySelector(".adv-app")).toHaveAttribute("data-platform", "telegram");
    // Email-вход и напоминания в Telegram скрыты.
    expect(screen.queryByText(copy.saveTitle)).toBeNull();
  });

  it("берёт текст согласия для Telegram из пакета, если он задан", async () => {
    window.Telegram = { WebApp: fakeWebApp() };
    const harness = memoryAdventApi({ start: at(3) });
    const custom = { ...advent, legal: { ...advent.legal, telegramConsentText: "Согласен на обработку идентификатора Telegram" } };
    render(<AdventGame advent={custom} world={snowGlobe} api={harness.api} />);
    expect(await screen.findByText("Согласен на обработку идентификатора Telegram")).toBeInTheDocument();
    expect(screen.queryByText(advent.legal.consentText)).toBeNull();
  });

  it("повторный вход: участник есть — сразу календарь, экран согласия не показывается", async () => {
    window.Telegram = { WebApp: fakeWebApp() };
    const harness = memoryAdventApi({ start: at(3) });
    await harness.ensureParticipant();
    render(<AdventGame advent={advent} world={snowGlobe} api={harness.api} />);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(screen.queryByText(copy.telegramConsentTitle)).toBeNull();
  });

  it("BackButton показывается с листом дня, закрывает его и прячется; тактильный отклик на открытие окна", async () => {
    const fake = fakeWebApp();
    window.Telegram = { WebApp: fake };
    const harness = memoryAdventApi({ start: at(3) });
    await harness.ensureParticipant();
    render(<AdventGame advent={advent} world={snowGlobe} api={harness.api} />);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(fake.calls).not.toContain("back:show");

    fireEvent.click(door(3));
    await waitFor(() => expect(document.querySelector(".adv-sheet")).not.toBeNull());
    expect(fake.calls).toContain("back:show");
    expect(fake.backClicks).toHaveLength(1);
    expect(fake.haptics).toContain("impact:medium");

    fake.backClicks[0]();
    await waitFor(() => expect(document.querySelector(".adv-sheet")).toBeNull());
    expect(fake.calls).toContain("back:hide");
    expect(fake.backClicks).toHaveLength(0);
  });

  it("ссылка на день (startapp=d3): день открывается один раз; закрытый день — остаёмся на фасаде", async () => {
    window.Telegram = { WebApp: fakeWebApp({ initDataUnsafe: { start_param: "d3_s_channel" } }) };
    const harness = memoryAdventApi({ start: at(3) });
    await harness.ensureParticipant();
    const open = vi.spyOn(harness.api, "openDay");
    render(<AdventGame advent={advent} world={snowGlobe} api={harness.api} />);
    await waitFor(() => expect(document.querySelector(".adv-sheet")).not.toBeNull());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(3);
    cleanup();

    window.Telegram = { WebApp: fakeWebApp({ initDataUnsafe: { start_param: "d9" } }) };
    const later = memoryAdventApi({ start: at(3) });
    await later.ensureParticipant();
    const openLater = vi.spyOn(later.api, "openDay");
    render(<AdventGame advent={advent} world={snowGlobe} api={later.api} />);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(openLater).not.toHaveBeenCalled();
    expect(document.querySelector(".adv-sheet")).toBeNull();
  });

  it("цвета шапки и фона Telegram — бренд (--bg), а не тема Telegram", async () => {
    const fake = fakeWebApp();
    window.Telegram = { WebApp: fake };
    document.documentElement.style.setProperty("--bg", "#1a100a");
    const harness = memoryAdventApi({ start: at(3) });
    await harness.ensureParticipant();
    render(<AdventGame advent={advent} world={snowGlobe} api={harness.api} />);
    await waitFor(() => expect(fake.colors).toEqual([["header", "#1a100a"], ["background", "#1a100a"]]));
    document.documentElement.style.removeProperty("--bg");
  });

  it("Telegram в пакете выключен: даже в Telegram игра открывается как обычный веб, скрипт не грузится", async () => {
    window.history.replaceState(null, "", "/#tgWebAppData=x");
    const harness = memoryAdventApi({ start: at(3) });
    const create = vi.spyOn(harness.api, "createParticipant");
    render(<AdventGame advent={publicConfig} world={snowGlobe} api={harness.api} />);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(create).toHaveBeenCalledWith();
    expect(document.querySelector(".adv-app")).toHaveAttribute("data-platform", "web");
    expect(document.querySelector("script[src*=telegram]")).toBeNull();
  });

  it("обычный веб (не Telegram): без BackButton и экрана согласия, участник создаётся сразу", async () => {
    const harness = memoryAdventApi({ start: at(3) });
    const create = vi.spyOn(harness.api, "createParticipant");
    render(<AdventGame advent={advent} world={snowGlobe} api={harness.api} />);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(create).toHaveBeenCalledWith();
    expect(screen.queryByText(copy.telegramConsentTitle)).toBeNull();
    expect(document.querySelector(".adv-app")).toHaveAttribute("data-platform", "web");
    expect(document.querySelector("script[src*=telegram]")).toBeNull();
  });
});
