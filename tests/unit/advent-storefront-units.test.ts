import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { garlandCaption, lowerFirst } from "@/components/advent/storefront/Garland";
import { daySteps, presentSteps } from "@/components/advent/storefront/StepRail";
import { PICK_SHAPES, pickShape } from "@/components/advent/storefront/skins/PickSkin";
import { WINDOW_ICON, WINDOW_SHAPE, openedWindowIcon, storeAction, windowStatusLabel } from "@/components/advent/storefront/windows";
import { DAY_DECOR_ICONS } from "@/config/facade";
import { REWARD_ICONS, rewardIconFor } from "@/config/advent-schema";
import type { AdventGrantView, AdventState } from "@/types/advent";

import { at } from "../support/advent";
import { memoryAdventApi } from "../support/advent-client";
import { config, fiveStatusState } from "../support/advent-ui";

const copy = config.copy;

describe("окна «Витрины»: статус виден формой, значком и подписью", () => {
  const statuses = ["locked", "today", "catchup", "missed", "opened"] as const;

  it("у пяти статусов пять разных форм, значков и подписей", () => {
    expect(new Set(statuses.map((status) => WINDOW_SHAPE[status])).size).toBe(5);
    expect(new Set(statuses.map((status) => WINDOW_ICON[status])).size).toBe(5);
    expect(new Set(statuses.map((status) => windowStatusLabel(copy, status))).size).toBe(5);
  });
});

describe("значок открытого окна", () => {
  const grant = (patch: Partial<AdventGrantView>): AdventGrantView => ({
    id: "g", source: "day", day: 3, rewardId: "r", kind: "gift", label: "Награда", description: "", icon: "pastry", status: "issued", expiresAt: null, code: null,
    grantedAt: "2026-12-22T09:00:00.000Z", redeemedAt: null, redeem: "none", url: null, needsIdentity: false, codePending: false, qr: null, ...patch
  });

  it("берётся значок награды, полученной за этот день (подарок дня или удача)", () => {
    expect(openedWindowIcon(3, [grant({})])).toBe("pastry");
    expect(openedWindowIcon(3, [grant({ source: "luck", icon: "cup" })])).toBe("cup");
  });

  it("награда за другой день или за серию окну не подходит: показывается значок-декор по номеру дня", () => {
    expect(openedWindowIcon(3, [grant({ day: 4 })])).toBe(DAY_DECOR_ICONS[2 % DAY_DECOR_ICONS.length]);
    expect(openedWindowIcon(3, [grant({ source: "goal" as never })])).toBe(DAY_DECOR_ICONS[2 % DAY_DECOR_ICONS.length]);
    expect(openedWindowIcon(1, [])).toBe(DAY_DECOR_ICONS[0]);
  });

  it("значок награды по умолчанию — по виду награды; свой значок важнее", () => {
    expect(rewardIconFor({ kind: "promo" })).toBe("percent");
    expect(rewardIconFor({ kind: "gift" })).toBe("gift");
    expect(rewardIconFor({ kind: "finalEntry" })).toBe("ticket");
    // Звезда — знак финального окна, поэтому баллы по умолчанию получают «искорку».
    expect(rewardIconFor({ kind: "points" })).toBe("sparkle");
    expect(rewardIconFor({ kind: "gift", icon: "cup" })).toBe("cup");
    for (const icon of REWARD_ICONS) expect(typeof icon).toBe("string");
  });
});

describe("нижняя плашка: одна большая кнопка", () => {
  it("сегодня окно закрыто для игрока — «Открыть окно N» с анонсом дня", async () => {
    const harness = memoryAdventApi({ start: at(6) });
    await harness.ensureParticipant();
    const state = await harness.api.getState();
    const action = storeAction(state, copy);
    expect(action).toMatchObject({ kind: "open", n: 6, label: "Открыть окно 6" });
    expect(action.line).toBe(state.doors[5].teaser);
  });

  it("окно начато, но не пройдено — «Продолжить окно N»", async () => {
    const harness = memoryAdventApi({ start: at(2) });
    await harness.ensureParticipant();
    const { state } = await harness.api.openDay(2);
    expect(storeAction(state, copy)).toMatchObject({ kind: "continue", n: 2, label: "Продолжить окно 2" });
  });

  it("сегодня всё пройдено, а вчерашний день можно догнать — «Догнать окно N» с анонсом этого дня", () => {
    const state = {
      today: 3,
      doors: [
        { n: 1, status: "missed", completed: false, teaser: "один" },
        { n: 2, status: "catchup", completed: false, teaser: "два" },
        { n: 3, status: "opened", completed: true, teaser: "три" }
      ]
    } as unknown as AdventState;
    expect(storeAction(state, copy)).toEqual({ kind: "catchup", n: 2, label: "Догнать окно 2", line: "два" });
  });

  it("день 4 при пропущенных 2–3: сегодня не открыто — открыть сегодня, а не догонять", async () => {
    const state = await fiveStatusState();
    expect(storeAction(state, copy)).toMatchObject({ kind: "open", n: 4 });
  });

  it("всё закрыто и догонять нечего — «До завтра» без окна", () => {
    const state = { today: 1, doors: [{ n: 1, status: "opened", completed: true, teaser: "x" }, { n: 2, status: "locked", completed: false, teaser: "y" }] } as unknown as AdventState;
    expect(storeAction(state, copy)).toEqual({ kind: "tomorrow", n: null, label: copy.storeTomorrow, line: copy.storeHostLine });
  });

  it("анонс закрытого завтрашнего дня в реплику не попадает", () => {
    const state = { today: 1, doors: [{ n: 1, status: "opened", completed: true, teaser: "сегодня" }, { n: 2, status: "locked", completed: false, teaser: "СЕКРЕТ ЗАВТРА" }] } as unknown as AdventState;
    expect(JSON.stringify(storeAction(state, copy))).not.toContain("СЕКРЕТ ЗАВТРА");
  });
});

describe("подпись гирлянды", () => {
  it("«Ещё 2 окна — и награда цели»: склонение и первая буква награды строчная", async () => {
    const harness = memoryAdventApi({ start: at(1) });
    await harness.ensureParticipant();
    const state = await harness.api.getState();
    const caption = garlandCaption(state, copy);
    expect(caption).toMatch(/^Ещё \d+ (окно|окна|окон) — и /);
    expect(caption).toContain(lowerFirst(state.nextGoal!.label));
  });

  it("при N > 16 подпись считает окна, а не огоньки (один огонёк — несколько дней)", () => {
    const state = (totalDays: number, progress: number, goal: number) =>
      ({ totalDays, streak: { progress }, nextGoal: { opened: goal, rewardId: "g", label: "Главный приз" }, goals: [{}] }) as unknown as AdventState;
    // 24 дня — по 2 дня на огонёк: до цели на 12-м окне осталось 7 окон (4 огонька были бы неверны).
    expect(garlandCaption(state(24, 5, 12), copy)).toBe("Ещё 7 окон — и главный приз");
    expect(garlandCaption(state(31, 10, 13), copy)).toBe("Ещё 3 окна — и главный приз");
    expect(garlandCaption(state(31, 12, 13), copy)).toBe("Ещё 1 окно — и главный приз");
    // Цель внутри того же огонька: раньше выпадало в «Горит k из n», теперь честно считает окна.
    expect(garlandCaption(state(24, 11, 12), copy)).toBe("Ещё 1 окно — и главный приз");
    expect(garlandCaption(state(12, 4, 8), copy)).toBe("Ещё 4 окна — и главный приз");
  });

  it("lowerFirst не трогает аббревиатуры и имена с заглавной второй буквой", () => {
    expect(lowerFirst("Участие в розыгрыше")).toBe("участие в розыгрыше");
    expect(lowerFirst("ПДн-подарок")).toBe("ПДн-подарок");
    expect(lowerFirst("VIP")).toBe("VIP");
    expect(lowerFirst("")).toBe("");
  });

  it("цели достигнуты — «Все цели достигнуты»; целей нет — «Горит k из n»", () => {
    const base = { totalDays: 12, streak: { progress: 12 }, nextGoal: null } as unknown as AdventState;
    expect(garlandCaption({ ...base, goals: [{}] } as unknown as AdventState, copy)).toBe(copy.garlandDone);
    expect(garlandCaption({ ...base, goals: [] } as unknown as AdventState, copy)).toBe("Горит 12 из 12");
  });
});

describe("шаги дня: история → задание → подарок", () => {
  it("в индикаторе только шаги, которые есть в дне", () => {
    expect(presentSteps([{ type: "story" }, { type: "task" }], false)).toEqual(["story", "task"]);
    expect(presentSteps([{ type: "story" }, { type: "task" }], true)).toEqual(["story", "task", "gift"]);
    expect(presentSteps([{ type: "story" }, { type: "luck" }], false)).toEqual(["story", "gift"]);
    expect(presentSteps([{ type: "task" }, { type: "promo" }], false)).toEqual(["story", "task", "gift"]);
  });

  it("текущий шаг отмечен, прошлые пройдены, будущие впереди; пройденный день — все пройдены", () => {
    const all = ["story", "task", "gift"] as const;
    expect(daySteps(all, "story").map((step) => step.state)).toEqual(["now", "todo", "todo"]);
    expect(daySteps(all, "task").map((step) => step.state)).toEqual(["done", "now", "todo"]);
    expect(daySteps(all, "gift").map((step) => step.state)).toEqual(["done", "done", "now"]);
    expect(daySteps(all, "done").map((step) => step.state)).toEqual(["done", "done", "done"]);
    expect(daySteps(["story", "gift"], "task").map((step) => step.state)).toEqual(["done", "todo"]);
  });
});

describe("«pick» на прилавке: предметы разной формы", () => {
  it("соседние варианты никогда не совпадают по силуэту, форм не меньше пяти", () => {
    expect(PICK_SHAPES.length).toBeGreaterThanOrEqual(5);
    for (let index = 0; index < 12; index += 1) expect(pickShape(index)).not.toBe(pickShape(index + 1));
    expect(new Set([0, 1, 2, 3, 4].map(pickShape)).size).toBe(5);
  });
});

describe("цвета «Витрины»: только токены бренда", () => {
  const root = path.join(process.cwd(), "src", "components", "advent");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : /\.(css|tsx?)$/.test(name) ? [full] : [];
    });

  it("во всех файлах адвента, включая storefront/, нет hex и цветовых функций", () => {
    for (const file of files(root)) {
      const text = readFileSync(file, "utf8");
      const name = path.relative(root, file);
      expect(text.match(/#[0-9a-fA-F]{3,8}\b/g), `${name}: hex-цвет`).toBeNull();
      expect(text.match(/\b(?:rgba?|hsla?|oklch|lab)\(/g), `${name}: цвет-функция`).toBeNull();
      if (name.endsWith(".css")) expect(text.match(/(?<![-\w])(?:white|black)(?![-\w])/g) ?? [], `${name}: именованный цвет`).toEqual(name === "advent.css" ? expect.anything() : []);
    }
  });

  it("при prefers-reduced-motion фасад не анимируется: огоньки, свечение и кольцо сегодняшнего окна выключены", () => {
    const css = readFileSync(path.join(root, "storefront", "storefront.css"), "utf8");
    const block = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation: none !important");
    expect(block).toMatch(/\.adv-eave i/);
    expect(block).toMatch(/\.adv-window::before/);
    expect(block).toMatch(/\.adv-steam path/);
    // Общее правило advent.css гасит остальное внутри .adv-app.
    expect(readFileSync(path.join(root, "advent.css"), "utf8")).toMatch(/\.adv-app \*[^{]*\{[^}]*animation: none !important/);
  });

  it("у сегодняшнего окна пульсирует кольцо и стекло, а не сама кнопка (у кнопки в движении нет стабильной области нажатия)", () => {
    const css = readFileSync(path.join(root, "storefront", "storefront.css"), "utf8");
    expect(css).not.toMatch(/\.adv-window-today\s*\{[^}]*animation:/);
    expect(css).toMatch(/\.adv-window-today::before\s*\{[^}]*animation:/);
  });
});
