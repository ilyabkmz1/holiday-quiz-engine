import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { countdownParts, dayLabel, fill, grantCondition, safeHref } from "@/components/advent/format";
import { qrModel } from "@/components/advent/qr";
import { adventCopySchema } from "@/config/advent-schema";
import { publicAdvent } from "@/server/presentation";

import { adventConfig } from "../support/advent";

describe("тексты интерфейса адвента (copy)", () => {
  it("у каждого текста есть значение по умолчанию, пакету не нужно ничего задавать", () => {
    const copy = adventCopySchema.parse({});
    expect(Object.keys(copy).length).toBeGreaterThan(80);
    for (const [key, value] of Object.entries(copy)) expect(value.trim(), key).not.toBe("");
    // Метафора квиза (игрушки на ёлку) в copy не пропала: общая часть схемы сохранена.
    expect(copy.ornamentsMapLabel).toBe("Игрушки на ёлку");
  });

  it("пакет переопределяет только нужные тексты, остальные остаются по умолчанию", () => {
    const advent = adventConfig((draft) => {
      draft.copy = { calendarTitle: "Окна", doorToday: "Сегодня тут" };
    });
    expect(advent.copy.calendarTitle).toBe("Окна");
    expect(advent.copy.doorToday).toBe("Сегодня тут");
    expect(advent.copy.doorOpened).toBe(adventCopySchema.parse({}).doorOpened);
  });

  it("плейсхолдеры, которые подставляет клиент, на месте", () => {
    const copy = adventCopySchema.parse({});
    expect(copy.doorAria).toContain("{n}");
    expect(copy.doorAria).toContain("{status}");
    expect(copy.doorLockedHint).toContain("{date}");
    expect(copy.streakOpened).toContain("{k}");
    expect(copy.streakGoal).toContain("{left}");
    expect(copy.saveSentText).toContain("{email}");
    expect(copy.promoValidUntil).toContain("{date}");
    expect(copy.luckBoxLabel).toContain("{i}");
  });

  it("ссылка награды: только http и https (она попадает в href)", () => {
    const withUrl = (url: string) => adventConfig((draft) => {
      draft.rewards[0].url = url;
    });
    expect(withUrl("https://shop.example/promo").rewards[0].url).toBe("https://shop.example/promo");
    expect(withUrl("http://shop.example/promo").rewards[0].url).toBe("http://shop.example/promo");
    expect(() => withUrl("javascript:alert(1)")).toThrow(/http или https/);
    expect(() => withUrl("data:text/html;base64,AAAA")).toThrow();
    expect(() => withUrl("ftp://files.example/x")).toThrow(/http или https/);
  });
});

describe("публичный срез адвента для страницы", () => {
  const advent = adventConfig();
  const view = publicAdvent(advent, "zerno-advent", "snow-globe");

  it("содержит бренд, тексты, героев и расписание", () => {
    expect(view).toMatchObject({ slug: advent.slug, tenant: "zerno-advent", worldId: "snow-globe", title: advent.title, luckSkin: "boxes" });
    expect(view.heroes.map((hero) => hero.id)).toEqual(advent.heroes.map((hero) => hero.id));
    expect(view.schedule).toEqual({ timezone: "Europe/Moscow", startDate: "2026-12-20", days: 12, finaleAt: advent.schedule.finaleAt, claimEndsAt: advent.schedule.claimEndsAt });
    expect(view.legal).toEqual({ operatorName: advent.legal.operatorName, consentText: advent.legal.consentText });
  });

  it("не содержит заданий, ответов, наград, пулов удачи, политики и текстов разбора", () => {
    const json = JSON.stringify(view);
    const tasks = advent.days.flatMap((day) => day.blocks).flatMap((block) => (block.type === "task" ? [block.task] : []));
    for (const task of tasks) {
      for (const secret of [task.id, task.explanation, task.tip, task.thanks, task.oops]) expect(json).not.toContain(secret);
    }
    for (const reward of advent.rewards) {
      expect(json).not.toContain(reward.id);
      expect(json).not.toContain(reward.label);
    }
    // Верхние ключи — явный список: новое поле пакета на клиент не попадёт, пока его не перечислят в `publicAdvent`.
    expect(Object.keys(view).sort()).toEqual(
      ["brand", "copy", "facade", "heroes", "intro", "legal", "luckSkin", "presentation", "schedule", "slug", "story", "subtitle", "tenant", "title", "worldId"]
    );
    expect(Object.keys(view.schedule).sort()).toEqual(["claimEndsAt", "days", "finaleAt", "startDate", "timezone"]);
    expect(json).not.toContain(advent.legal.policyText);
    expect(json).not.toContain("fallbackRewardId");
  });

  it("без секции luck скина удачи нет", () => {
    const noLuck = adventConfig((draft) => {
      delete draft.luck;
      for (const day of draft.days) day.blocks = day.blocks.filter((block: { type: string }) => block.type !== "luck");
      for (const day of draft.days) if (day.blocks.length === 0) day.blocks = [{ type: "story", lines: ["Реплика"] }];
    });
    expect(publicAdvent(noLuck, "t").luckSkin).toBeNull();
  });
});

describe("форматирование", () => {
  it("fill подставляет значения и оставляет неизвестные плейсхолдеры", () => {
    expect(fill("День {n}: {status}", { n: 3, status: "Открыта" })).toBe("День 3: Открыта");
    expect(fill("{a} и {b}", { a: "x" })).toBe("x и {b}");
  });

  it("даты считаются в часовом поясе кампании", () => {
    // 20 декабря 00:00 в Москве — 19 декабря 21:00 UTC.
    expect(dayLabel("2026-12-19T21:00:00Z", "Europe/Moscow")).toBe("20 декабря");
    expect(dayLabel("2026-12-19T21:00:00Z", "UTC")).toBe("19 декабря");
  });

  it("отсчёт: дни, часы, минуты, секунды; в прошлом — нули", () => {
    const base = Date.parse("2026-12-10T12:00:00Z");
    expect(countdownParts(base + (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000, base)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 });
    expect(countdownParts(base - 1000, base)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it("safeHref пропускает только http и https", () => {
    expect(safeHref("https://a.example/x?y=1")).toBe("https://a.example/x?y=1");
    expect(safeHref("http://a.example/")).toBe("http://a.example/");
    for (const bad of ["javascript:alert(1)", "data:text/plain,hi", "//evil.example", "mailto:a@b.c", "", null]) expect(safeHref(bad)).toBeNull();
  });

  it("grantCondition: погашена, просрочена или действует", () => {
    const now = Date.parse("2026-12-22T12:00:00Z");
    expect(grantCondition({ status: "redeemed", expiresAt: null }, now)).toBe("redeemed");
    expect(grantCondition({ status: "issued", expiresAt: "2026-12-22T11:59:59Z" }, now)).toBe("expired");
    expect(grantCondition({ status: "issued", expiresAt: "2026-12-22T12:00:00Z" }, now)).toBe("expired");
    expect(grantCondition({ status: "issued", expiresAt: "2026-12-22T12:00:01Z" }, now)).toBe("active");
    expect(grantCondition({ status: "issued", expiresAt: null }, now)).toBe("active");
    expect(grantCondition({ status: "redeemed", expiresAt: "2026-12-01T00:00:00Z" }, now)).toBe("redeemed");
  });
});

describe("QR без внешних сервисов", () => {
  const payload = "ADV1.0a6f7c1e-6c8c-4f43-9a76-0d3a2a0f1b11.0123456789abcdef0123456789abcdef";

  it("модель детерминирована, размер — по стандарту версий, путь замкнут по строкам", () => {
    const first = qrModel(payload);
    expect(qrModel(payload)).toEqual(first);
    expect((first.size - 17) % 4).toBe(0);
    expect(first.size).toBeGreaterThanOrEqual(21);
    expect(first.size).toBeLessThanOrEqual(61);
    expect(first.path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
  });

  it("три угловых поисковых узора на месте: тёмные модули 7×7 по рамке", () => {
    const { size, path } = qrModel(payload);
    const dark = new Set<string>();
    for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g).map((match) => [match[0], Number(match[1]), Number(match[2]), Number(match[3])] as const)) {
      for (let column = x; column < x + w; column += 1) dark.add(`${column},${y}`);
    }
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let k = 0; k < 7; k += 1) {
        for (const cell of [`${ox + k},${oy}`, `${ox + k},${oy + 6}`, `${ox},${oy + k}`, `${ox + 6},${oy + k}`]) expect(dark.has(cell), cell).toBe(true);
      }
      // Центр узора 3×3 тоже тёмный, а кольцо между рамкой и центром светлое.
      expect(dark.has(`${ox + 3},${oy + 3}`)).toBe(true);
      expect(dark.has(`${ox + 1},${oy + 1}`)).toBe(false);
    }
  });

  it("разные коды дают разные картинки", () => {
    expect(qrModel(payload).path).not.toBe(qrModel(payload.replace("ADV1", "ADV2")).path);
  });
});

describe("стили адвента", () => {
  const dir = path.join(process.cwd(), "src", "components", "advent");
  const css = readFileSync(path.join(dir, "advent.css"), "utf8");

  it("цвета только из переменных бренда: ни hex, ни rgb()/hsl()", () => {
    const sources = readdirSync(dir).filter((name) => /\.(css|tsx?)$/.test(name));
    for (const name of sources) {
      const text = readFileSync(path.join(dir, name), "utf8");
      expect(text.match(/#[0-9a-fA-F]{3,8}\b/g), `${name}: hex-цвет`).toBeNull();
      expect(text.match(/\b(?:rgba?|hsla?|oklch|lab)\(/g), `${name}: цвет-функция`).toBeNull();
    }
  });

  it("именованные цвета white и black допустимы только в QR-коде (сканеру нужен чёрный на белом)", () => {
    const offenders = css.split("\n").filter((line) => /\b(?:white|black)\b/.test(line) && !/adv-qr|^\s*\/?\*/.test(line));
    expect(offenders).toEqual([]);
  });

  it("при prefers-reduced-motion анимации выключены, салют и снег скрыты", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation: none !important");
    expect(block).toMatch(/\.adv-burst[^{]*\{\s*display: none/);
    expect(block).toContain("transition-duration: 0s !important");
  });

  it("у сегодняшней двери «дышит» кольцо и число, а не сама кнопка (у кнопки в движении нет стабильной области нажатия)", () => {
    expect(css).not.toMatch(/\.adv-door-today\s*\{[^}]*animation:/);
    expect(css).toContain(".adv-door-today::after");
  });
});
