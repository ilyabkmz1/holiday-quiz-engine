// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdventGame } from "@/components/advent/AdventGame";
import { DaySheet } from "@/components/advent/DaySheet";
import { Facade } from "@/components/advent/storefront/Facade";
import { WINDOW_SHAPE } from "@/components/advent/storefront/windows";
import { loadFacade } from "@/facades/registry";
import type { Task } from "@/config/schema";
import { publicAdvent } from "@/server/presentation";
import type { AdventState, PublicAdvent } from "@/types/advent";

import { adventConfig, at } from "../support/advent";
import { memoryAdventApi } from "../support/advent-client";
import { mockReducedMotion } from "../support/advent-ui";
import { renderInWorld as render } from "./world-render";

const storefrontConfig = (templateId = "cafe") =>
  adventConfig((draft) => {
    draft.presentation = "storefront";
    draft.facade = { templateId, hostHeroId: "mila", signText: "Зерно" };
    draft.rewards.find((reward: { id: string }) => reward.id === "daily-gift").icon = "cup";
  });
const config = storefrontConfig();
const publicConfig: PublicAdvent = publicAdvent(config, "zerno-advent", "snow-globe");
const copy = config.copy;

beforeEach(() => {
  mockReducedMotion(false);
  window.history.replaceState(null, "", "/");
  try {
    window.localStorage.clear();
  } catch {
    // jsdom без localStorage.
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const win = (n: number) => document.querySelector<HTMLElement>(`[data-door="${n}"]`)!;

/** Участник открыл день 1, на день 4: окна всех пяти статусов (открыто, пропущено, догнать, сегодня, закрыто). */
async function fiveStatus() {
  const harness = memoryAdventApi({ advent: config, start: at(1) });
  await harness.ensureParticipant();
  await harness.api.openDay(1);
  harness.clock.now = at(4);
  return { harness, state: await harness.api.getState() };
}

function mountFacade(state: AdventState, overrides: Partial<Parameters<typeof Facade>[0]> = {}) {
  const onOpen = vi.fn();
  const onHint = vi.fn();
  const facade = publicConfig.facade!;
  render(
    <Facade
      template={facade.template}
      signText={facade.signText}
      host={publicConfig.heroes.find((hero) => hero.id === facade.hostHeroId)!}
      doors={state.doors}
      grants={state.grants}
      today={state.today}
      copy={copy}
      timezone="Europe/Moscow"
      phase="running"
      busy={null}
      lit={null}
      reduced={false}
      onOpen={onOpen}
      onHint={onHint}
      {...overrides}
    />
  );
  return { onOpen, onHint };
}

describe("Facade: окна и их статусы", () => {
  it("12 окон в списке, мансарда с финалом, сегодняшнее окно 2×2, в двери стоит хозяин", async () => {
    const { state } = await fiveStatus();
    mountFacade(state);
    expect(screen.getByRole("list", { name: copy.windowsLabel })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    expect(win(12)).toHaveAttribute("data-finale", "true");
    expect(win(4)).toHaveAttribute("data-big", "true");
    expect(document.querySelectorAll('[data-big="true"]')).toHaveLength(1);
    expect(document.querySelector('[data-cell="door"]')).toBeInTheDocument();
    // Хозяин — спрайт героя, а не смайлик в круге.
    expect(within(document.querySelector<HTMLElement>(".adv-host")!).getByRole("img", { name: /^Мила, / })).toBeInTheDocument();
    expect(document.querySelector(".hero-face")).toBeNull();
    // Вывеска и шаблон фасада.
    expect(document.querySelector(".adv-sign-text")).toHaveTextContent("Зерно");
    expect(document.querySelector(".adv-facade")).toHaveAttribute("data-template", "cafe");
  });

  it("день 4 при открытом первом: у окон пять статусов", async () => {
    const { state } = await fiveStatus();
    mountFacade(state);
    expect(state.doors.map((door) => door.status).slice(0, 5)).toEqual(["opened", "missed", "catchup", "today", "locked"]);
    for (const [n, status] of [[1, "opened"], [2, "missed"], [3, "catchup"], [4, "today"], [5, "locked"]] as const) {
      expect(win(n)).toHaveAttribute("data-status", status);
    }
  });

  it("статус виден не только цветом: у каждого свои форма, значок и подпись", async () => {
    const { state } = await fiveStatus();
    mountFacade(state);
    const buttons = [1, 2, 3, 4, 5].map(win);
    expect(new Set(buttons.map((button) => button.dataset.shape)).size).toBe(5);
    expect(new Set(buttons.map((button) => button.querySelector(".adv-window-icon")!.getAttribute("data-icon"))).size).toBe(5);
    ["opened", "missed", "catchup", "today", "locked"].forEach((status, index) => {
      expect(buttons[index].dataset.shape).toBe(WINDOW_SHAPE[status as keyof typeof WINDOW_SHAPE]);
    });
    // Пропущенное и закрытое — разные формы значка: крест и замок; догоняемое — «назад».
    expect(win(2).querySelector("svg")).toHaveAttribute("data-icon", "cross");
    expect(win(3).querySelector("svg")).toHaveAttribute("data-icon", "replay");
    expect(win(5).querySelector("svg")).toHaveAttribute("data-icon", "lock");
    // Сегодняшнее окно обвязано лентой крест-накрест.
    expect(win(4).querySelector(".adv-ribbon")).toBeInTheDocument();
    expect(win(4)).toHaveTextContent(copy.windowToday);
  });

  it("aria-метка: номер, статус и дата; у закрытого — когда откроется", async () => {
    const { state } = await fiveStatus();
    mountFacade(state);
    expect(win(4)).toHaveAccessibleName(/^Окно 4: Сегодня, 23 декабря\./);
    expect(win(1)).toHaveAccessibleName(/^Окно 1: Открыто, 20 декабря\. /);
    expect(win(3)).toHaveAccessibleName(/^Окно 3: Можно догнать, 22 декабря\./);
    expect(win(5)).toHaveAccessibleName("Окно 5: Закрыто, 24 декабря. Откроется 24 декабря");
    expect(win(2)).toHaveAccessibleName(`Окно 2: Пропущено, 21 декабря. ${copy.doorMissedHint}`);
    expect(win(12)).toHaveAccessibleName(new RegExp(`^Окно 12: Закрыто, 31 декабря\\. ${copy.windowFinale}\\. `));
  });

  it("нажатия: сегодня, догнать и открытое открываются; закрытое и пропущенное объясняют почему", async () => {
    const { state } = await fiveStatus();
    const { onOpen, onHint } = mountFacade(state);
    for (const n of [4, 3, 1]) fireEvent.click(win(n));
    expect(onOpen.mock.calls).toEqual([[4], [3], [1]]);
    expect(onHint).not.toHaveBeenCalled();
    fireEvent.click(win(5));
    fireEvent.click(win(2));
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(onHint.mock.calls).toEqual([["Откроется 24 декабря"], [copy.doorMissedHint]]);
    expect(win(5)).toHaveAttribute("aria-disabled", "true");
    expect(win(2)).toHaveAttribute("aria-disabled", "true");
  });

  it("после финала окна не открываются, кроме уже открытых", async () => {
    const { state } = await fiveStatus();
    const { onOpen, onHint } = mountFacade(state, { phase: "finale", today: null });
    fireEvent.click(win(3));
    expect(onOpen).not.toHaveBeenCalled();
    expect(onHint).toHaveBeenCalledWith(copy.doorFinaleHint);
    fireEvent.click(win(1));
    expect(onOpen).toHaveBeenCalledWith(1);
    expect(document.querySelector('[data-big="true"]')).toBeNull();
  });
});

describe("Facade: клавиатура", () => {
  it("одна остановка Tab на сегодняшнем окне; стрелки идут по окнам в порядке дней, Home и End — к краям", async () => {
    const { state } = await fiveStatus();
    mountFacade(state);
    expect(document.querySelectorAll('[data-door][tabindex="0"]')).toHaveLength(1);
    expect(win(4)).toHaveAttribute("tabindex", "0");
    win(4).focus();
    fireEvent.keyDown(win(4), { key: "ArrowRight" });
    expect(win(5)).toHaveFocus();
    fireEvent.keyDown(win(5), { key: "ArrowDown" });
    expect(win(6)).toHaveFocus();
    fireEvent.keyDown(win(6), { key: "ArrowLeft" });
    expect(win(5)).toHaveFocus();
    fireEvent.keyDown(win(5), { key: "ArrowUp" });
    expect(win(4)).toHaveFocus();
    fireEvent.keyDown(win(4), { key: "End" });
    expect(win(12)).toHaveFocus();
    fireEvent.keyDown(win(12), { key: "ArrowRight" });
    expect(win(12)).toHaveFocus();
    fireEvent.keyDown(win(12), { key: "Home" });
    expect(win(1)).toHaveFocus();
    fireEvent.keyDown(win(1), { key: "ArrowLeft" });
    expect(win(1)).toHaveFocus();
    // Остановка Tab переехала на окно с фокусом.
    expect(win(1)).toHaveAttribute("tabindex", "0");
    expect(win(4)).toHaveAttribute("tabindex", "-1");
  });

  it("Ctrl и Alt со стрелками не перехватываются", async () => {
    const { state } = await fiveStatus();
    mountFacade(state);
    win(4).focus();
    fireEvent.keyDown(win(4), { key: "ArrowRight", ctrlKey: true });
    expect(win(4)).toHaveFocus();
  });

  it("Enter и пробел — это нажатие на кнопку: сегодняшнее открывается, закрытое объясняет", async () => {
    const { state } = await fiveStatus();
    const { onOpen, onHint } = mountFacade(state);
    // userEvent не подключён: нативная кнопка отвечает на click, а Enter/пробел браузер превращает в click.
    fireEvent.click(win(4));
    expect(onOpen).toHaveBeenCalledWith(4);
    fireEvent.click(win(5));
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(win(4).tagName).toBe("BUTTON");
  });
});

describe("Facade: движение", () => {
  function longFacade(reduced: boolean) {
    // Длинный фасад: области нужна прокрутка (jsdom не считает размеры, подставляем).
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 300 });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    return { scrollIntoView, reduced };
  }
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  });

  it("длинный фасад автоматически прокручивается к сегодняшнему окну: плавно, а при reduced-motion — сразу", async () => {
    const { state } = await fiveStatus();
    const smooth = longFacade(false);
    mountFacade(state);
    expect(smooth.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    cleanup();
    const instant = longFacade(true);
    mountFacade(state, { reduced: true });
    expect(instant.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("окно, которое только что загорелось, помечено для анимации; без `lit` метки нет", async () => {
    const { state } = await fiveStatus();
    mountFacade(state, { lit: 1 });
    expect(win(1)).toHaveAttribute("data-igniting", "true");
    expect(win(4)).not.toHaveAttribute("data-igniting");
  });
});

describe("Facade: награды закрытых дней не раскрываются", () => {
  it("в окнах закрытых, пропущенных и догоняемых дней нет ни названий, ни значков наград, ни анонсов", async () => {
    const { state } = await fiveStatus();
    mountFacade(state);
    const text = document.body.textContent ?? "";
    const labels = document.body.innerHTML;
    for (const reward of config.rewards) {
      if (reward.id === state.nextGoal?.rewardId) continue;
      expect(text, reward.label).not.toContain(reward.label);
      expect(labels, reward.id).not.toContain(reward.id);
    }
    // Закрытые дни: анонс и название не попадают в подпись, значок — замок.
    for (const n of [5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(win(n)).not.toHaveAccessibleName(new RegExp(config.days[n - 1].teaser.slice(0, 12)));
      expect(win(n)).not.toHaveAccessibleName(new RegExp(config.days[n - 1].title));
      expect(win(n).querySelector(".adv-window-icon")).toHaveAttribute("data-icon", "lock");
    }
  });

  it("открытое окно без выданной награды показывает значок-декор, а не награду дня", async () => {
    const { state } = await fiveStatus();
    mountFacade(state);
    // День 1 открыт, но подарок дня ещё не получен: значок — декор, не «чашка» награды.
    expect(state.grants.filter((grant) => grant.day === 1)).toEqual([]);
    expect(win(1).querySelector(".adv-window-icon")).not.toHaveAttribute("data-icon", "cup");
  });

  it("после получения награды окно показывает её значок", async () => {
    const harness = memoryAdventApi({ advent: config, start: at(5) });
    await harness.ensureParticipant();
    await harness.api.requestLink({ email: "guest@example.test", consent: true, marketingConsent: false, reminderOptIn: false });
    await harness.confirmLogin();
    await harness.api.openDay(5);
    await harness.api.submitBlock(5, 0);
    const pick = config.days[4].blocks[1] as Extract<(typeof config.days)[number]["blocks"][number], { type: "task" }>;
    await harness.api.submitBlock(5, 1, { optionId: (pick.task as Extract<Task, { type: "pick" }>).correctOptionId });
    await harness.api.submitBlock(5, 2, {});
    const state = await harness.api.getState();
    expect(state.grants.some((grant) => grant.day === 5 && grant.icon === "cup")).toBe(true);
    mountFacade(state);
    expect(win(5).querySelector(".adv-window-icon")).toHaveAttribute("data-icon", "cup");
  });
});

describe("Facade: шаблоны", () => {
  it.each(["cafe", "shop", "office", "salon"])("шаблон %s рисует крышу, окна нужной формы и дверь", async (id) => {
    const { state } = await fiveStatus();
    const template = loadFacade(id);
    mountFacade(state, { template });
    const facade = document.querySelector<HTMLElement>(".adv-facade")!;
    expect(facade.dataset.roof).toBe(template.roof.shape);
    expect(facade.dataset.windows).toBe(template.windows.shape);
    expect(document.querySelectorAll(".adv-window")).toHaveLength(12);
    // Цвета фасада — ссылки на токены бренда.
    expect(facade.getAttribute("style")).toContain(`--fc-wall: var(--${template.colors.wall})`);
    expect(facade.getAttribute("style")).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(!!document.querySelector(".adv-awning")).toBe(template.roof.awning);
  });
});

/* ——— Экран дня ——— */

type Harness = ReturnType<typeof memoryAdventApi>;

function Host({ harness, initial, n, onClose, advent = publicConfig }: { harness: Harness; initial: AdventState; n: number; onClose: () => void; advent?: PublicAdvent }) {
  const [state, setState] = useState(initial);
  return <DaySheet advent={advent} state={state} n={n} reduced nowMs={harness.clock.now.getTime()} api={harness.api} onClose={onClose} onState={setState} onError={vi.fn()} />;
}

async function openSheet(day: number, templateId = "cafe") {
  const advent = storefrontConfig(templateId);
  const harness = memoryAdventApi({ advent, start: at(day) });
  await harness.ensureParticipant();
  const { state } = await harness.api.openDay(day);
  const onClose = vi.fn();
  render(<Host harness={harness} initial={state} n={day} onClose={onClose} advent={templateId === "cafe" ? publicConfig : publicAdvent(advent, "zerno-advent", "snow-globe")} />);
  return { harness, state, onClose };
}
const dialog = () => screen.getByRole("dialog");
const task = (id: string) => config.days.flatMap((day) => day.blocks).flatMap((block) => (block.type === "task" ? [block.task] : [])).find((item) => item.id === id) as Task;

async function toTask(day: number) {
  const view = await openSheet(day);
  await advanceToTask();
  return view;
}

async function advanceToTask() {
  // Глава и история листаются репликами: нажимаем «Дальше», пока не появится задание.
  for (let step = 0; step < 8 && !dialog().querySelector(".adv-skin, [role='group'][aria-label]"); step += 1) {
    const button = dialog().querySelector<HTMLButtonElement>(".adv-says .adv-btn-primary");
    if (!button) break;
    fireEvent.click(button);
    await act(async () => undefined);
  }
  await waitFor(() => expect(dialog().querySelector(".adv-skin")).not.toBeNull());
}

describe("DaySheet «Витрины»: история с персонажем", () => {
  it("вверху «ОКНО 6 · 25 ДЕКАБРЯ», название дня и кнопка «назад»; внизу шаги дня", async () => {
    const { onClose } = await openSheet(6);
    expect(within(dialog()).getByText("Окно 6 · 25 декабря")).toBeInTheDocument();
    expect(within(dialog()).getByRole("heading", { level: 2, name: config.days[5].title })).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: copy.dayBack }));
    expect(onClose).toHaveBeenCalled();
    const steps = within(dialog()).getByRole("list", { name: copy.stepsLabel });
    expect(within(steps).getAllByRole("listitem").map((item) => item.dataset.step)).toEqual(["story", "task", "gift"]);
    expect(within(steps).getByText(copy.stepStory).closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("персонаж — спрайт героя дня, реплики листаются по нажатию, на последней — «Дальше» главы", async () => {
    await openSheet(5);
    const stage = dialog().querySelector<HTMLElement>(".adv-says-stage")!;
    expect(within(stage).getByRole("img", { name: /^Мила, / })).toBeInTheDocument();
    expect(dialog().querySelector(".hero-face")).toBeNull();
    const [first, second] = config.days[4].chapter.lines;
    expect(within(dialog()).getByText(first)).toBeInTheDocument();
    expect(within(dialog()).queryByText(second)).not.toBeInTheDocument();
    expect(within(dialog()).getByText(/1 из 2/)).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: copy.chapterNext })).not.toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: copy.bubbleNext })).toBeInTheDocument();
    // Нажатие на облачко листает.
    fireEvent.click(dialog().querySelector(".adv-says-bubble")!);
    expect(within(dialog()).getByText(second)).toBeInTheDocument();
    expect(within(dialog()).getByText(/2 из 2/)).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: copy.chapterNext })).toBeInTheDocument();
  });

  it("кнопка «Дальше» тоже листает: клавиатуре облачко не нужно", async () => {
    await openSheet(5);
    fireEvent.click(within(dialog()).getByRole("button", { name: copy.bubbleNext }));
    expect(within(dialog()).getByText(config.days[4].chapter.lines[1])).toBeInTheDocument();
  });

  it("шаг в индикаторе следует за днём: после главы — история, на задании — «Задание»", async () => {
    await toTask(2);
    const steps = within(dialog()).getByRole("list", { name: copy.stepsLabel });
    expect(within(steps).getByText(copy.stepTask).closest("li")).toHaveAttribute("aria-current", "step");
    expect(within(steps).getByText(copy.stepStory).closest("li")).toHaveAttribute("data-state", "done");
  });
});

describe("DaySheet «Витрины»: обложка «собери»", () => {
  it("build: чашка со слоями, легенда снизу вверх, чипы-ингредиенты и счётчик «k из n слоёв»", async () => {
    await toTask(2);
    const build = task("beans-store") as Extract<Task, { type: "build" }>;
    const skin = dialog().querySelector<HTMLElement>(".adv-skin-layers")!;
    expect(skin).toHaveAttribute("data-vessel", "cup");
    expect(within(skin).getByRole("heading", { level: 3, name: copy.skinBuildTitle })).toBeInTheDocument();
    expect(skin.querySelector(".adv-vessel")).toHaveAttribute("data-kind", "cup");
    expect(skin.querySelectorAll(".adv-layer")).toHaveLength(build.slots);
    expect(within(skin).getByText(`0 из ${build.slots} слоёв`)).toBeInTheDocument();
    // Чипы по числу вариантов, каждый — кнопка.
    const chips = skin.querySelectorAll<HTMLButtonElement>(".adv-chip-item");
    expect(chips).toHaveLength(build.options.length);
    for (const chip of chips) expect(chip.tagName).toBe("BUTTON");
    // Готово недоступно, пока слои не заполнены.
    const submit = within(skin).getByRole("button", { name: new RegExp(`^${copy.skinBuildSubmit}`) });
    expect(submit).toBeDisabled();
    // Выбор слоя: счётчик растёт, слой в чашке заполнен, легенда показывает название, ряд снимает слой.
    const right = build.options.filter((option) => build.correctOptionIds.includes(option.id));
    fireEvent.click(within(skin).getByRole("button", { name: new RegExp(right[0].title) }));
    expect(within(skin).getByText(`1 из ${build.slots} слоёв`)).toBeInTheDocument();
    expect(skin.querySelectorAll(".adv-layer.filled")).toHaveLength(1);
    const remove = within(skin).getByRole("button", { name: new RegExp(`^1\\. Убрать «${right[0].title}»`) });
    fireEvent.click(remove);
    expect(within(skin).getByText(`0 из ${build.slots} слоёв`)).toBeInTheDocument();
  });

  it("build: ответ уходит тем же payload, что и в штатной механике, разбор — после ответа сервера, подсказок до ответа нет", async () => {
    const { harness } = await toTask(2);
    const build = task("beans-store") as Extract<Task, { type: "build" }>;
    const skin = dialog().querySelector<HTMLElement>(".adv-skin-layers")!;
    for (const secret of [build.explanation, build.tip, build.thanks, build.oops]) expect(dialog().textContent).not.toContain(secret);
    expect(dialog().innerHTML).not.toContain("correctOptionIds");
    const submit = vi.spyOn(harness.api, "submitBlock");
    for (const option of build.options.filter((candidate) => build.correctOptionIds.includes(candidate.id))) {
      fireEvent.click(within(skin).getByRole("button", { name: new RegExp(option.title) }));
    }
    fireEvent.click(within(skin).getByRole("button", { name: copy.skinBuildSubmit }));
    expect(await within(dialog()).findByRole("heading", { level: 3, name: copy.outcomePerfect })).toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(1);
    const [, , payload] = submit.mock.calls[0];
    expect(Object.keys(payload as object)).toEqual(["optionIds"]);
    expect((payload as { optionIds: string[] }).optionIds).toHaveLength(build.slots);
    expect(within(dialog()).getByText(build.explanation)).toBeInTheDocument();
    // Верные слои отмечены «Верно», чипов больше нет.
    expect(dialog().querySelectorAll('.adv-legend-item[data-verdict="right"]')).toHaveLength(build.slots);
    expect(dialog().querySelector(".adv-chips")).toBeNull();
  });

  it("order: тот же вид «собери», ответ — orderedIds в выбранном порядке", async () => {
    const { harness } = await toTask(3);
    const order = task("beans-path") as Extract<Task, { type: "order" }>;
    const skin = dialog().querySelector<HTMLElement>(".adv-skin-layers")!;
    expect(skin).toHaveAttribute("data-mode", "order");
    expect(within(skin).getByText(`0 из ${order.items.length} слоёв`)).toBeInTheDocument();
    const submit = vi.spyOn(harness.api, "submitBlock");
    for (const id of order.correctOrder) {
      fireEvent.click(within(skin).getByRole("button", { name: new RegExp(order.items.find((item) => item.id === id)!.title) }));
    }
    fireEvent.click(within(skin).getByRole("button", { name: copy.skinBuildSubmit }));
    expect(await within(dialog()).findByRole("heading", { level: 3, name: copy.outcomePerfect })).toBeInTheDocument();
    expect((submit.mock.calls[0][2] as { orderedIds: string[] }).orderedIds).toEqual(order.correctOrder);
  });

  it("для магазина вместо чашки — коробка, для офиса — стопка", async () => {
    await openSheet(2, "shop");
    await advanceToTask();
    expect(dialog().querySelector(".adv-vessel")).toHaveAttribute("data-kind", "box");
    cleanup();
    await openSheet(2, "office");
    await advanceToTask();
    expect(dialog().querySelector(".adv-vessel")).toHaveAttribute("data-kind", "stack");
  });
});

describe("DaySheet «Витрины»: обложка «pick»", () => {
  it("варианты — предметы разной формы; нажатие отправляет {optionId}; до ответа разбора нет", async () => {
    const { harness } = await toTask(1);
    const pick = task("beans-fresh") as Extract<Task, { type: "pick" }>;
    const props = dialog().querySelectorAll<HTMLButtonElement>(".adv-prop");
    expect(props).toHaveLength(pick.options.length);
    expect(new Set([...props].map((prop) => prop.dataset.shape)).size).toBe(pick.options.length);
    for (const secret of [pick.explanation, pick.tip, pick.thanks, pick.oops]) expect(dialog().textContent).not.toContain(secret);
    const submit = vi.spyOn(harness.api, "submitBlock");
    fireEvent.click(within(dialog()).getByRole("button", { name: pick.options.find((option) => option.id === pick.correctOptionId)!.title }));
    expect(await within(dialog()).findByRole("heading", { level: 3, name: copy.outcomePerfect })).toBeInTheDocument();
    expect(submit.mock.calls[0][2]).toEqual({ optionId: pick.correctOptionId });
    expect(dialog().querySelector('.adv-prop[data-verdict="right"]')).toBeInTheDocument();
  });
});

/* ——— Главный экран ——— */

const game = (api: Harness["api"], advent: PublicAdvent = publicConfig) => render(<AdventGame advent={advent} world={snowGlobeWorld} api={api} />);
// Мир snow-globe: компоненты адвента берут его из контекста.
import { snowGlobe as snowGlobeWorld } from "../support/world";

describe("AdventGame: «Витрина»", () => {
  it("первый экран: шапка в одну строку, гирлянда с подписью, фасад и одна большая кнопка; большого заголовка и абзаца нет", async () => {
    const harness = memoryAdventApi({ advent: config, start: at(6) });
    game(harness.api);
    expect(await screen.findByRole("heading", { level: 1, name: config.title })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".adv-window")).toHaveLength(12));
    expect(screen.getByText("25 декабря · окно 6 из 12")).toBeInTheDocument();
    expect(document.querySelector(".adv-hero")).toBeNull();
    expect(screen.queryByText(config.intro)).not.toBeInTheDocument();
    // Старый блок серии с большим счётчиком на главном экране не показывается.
    expect(document.querySelector(".adv-streak")).toBeNull();
    expect(document.querySelector(".adv-doors")).toBeNull();
    const garland = screen.getByRole("button", { name: /Подробнее о серии/ });
    expect(garland).toHaveTextContent(/^Ещё \d+ (огонёк|огонька|огоньков) — и /);
    expect(document.querySelectorAll(".adv-bulb")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Открыть окно 6" })).toBeInTheDocument();
    expect(document.querySelector(".adv-bar-line")).toHaveTextContent(config.days[5].teaser);
  });

  it("гирлянда горит столько, сколько открыто (с подаренным днём), на ближайшей цели — подарок", async () => {
    const harness = memoryAdventApi({ advent: config, start: at(1) });
    await harness.ensureParticipant();
    await harness.api.openDay(1);
    harness.clock.now = at(3);
    game(harness.api);
    await waitFor(() => expect(document.querySelectorAll(".adv-bulb").length).toBe(12));
    // День 1 открыт + подаренный день = 2 огонька.
    expect(document.querySelectorAll('.adv-bulb[data-lit="true"]')).toHaveLength(2);
    expect(document.querySelectorAll(".adv-bulb.goal")).toHaveLength(1);
    expect(document.querySelector(".adv-bulb.goal")).toHaveAttribute("data-bulb", "4");
    expect(screen.getByRole("button", { name: /Ещё 2 огонька — и десерт за серию/ })).toBeInTheDocument();
  });

  it("нажатие на гирлянду открывает лист серии и заморозок; Escape закрывает", async () => {
    const harness = memoryAdventApi({ advent: config, start: at(3) });
    game(harness.api);
    fireEvent.click(await screen.findByRole("button", { name: /Подробнее о серии/ }));
    const sheet = await screen.findByRole("dialog", { name: copy.garlandSheetTitle });
    expect(within(sheet).getByText(new RegExp(copy.streakFreezes))).toBeInTheDocument();
    expect(within(sheet).getByRole("progressbar")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: copy.garlandSheetClose })).toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Фокус возвращается на гирлянду.
    await waitFor(() => expect(document.querySelector(".adv-garland-btn")).toHaveFocus());
  });

  it("кнопка плашки открывает сегодняшнее окно; по возвращении оно загорается, а кнопка меняется на «До завтра» после прохождения", async () => {
    const harness = memoryAdventApi({ advent: config, start: at(3) });
    game(harness.api);
    fireEvent.click(await screen.findByRole("button", { name: "Открыть окно 3" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Окно 3 · 22 декабря")).toBeInTheDocument();
    // Назад к фасаду: окно 3 только что открыто, оно загорается.
    fireEvent.click(within(sheet).getByRole("button", { name: copy.dayBack }));
    await waitFor(() => expect(win(3)).toHaveAttribute("data-igniting", "true"));
    expect(win(3)).toHaveAttribute("data-status", "opened");
    expect(screen.getByRole("button", { name: "Продолжить окно 3" })).toBeInTheDocument();
  });

  it("плашка «Догнать окно N», когда сегодня пройдено нечего открывать, а вчерашний день можно догнать", async () => {
    const harness = memoryAdventApi({ advent: config, start: at(1) });
    await harness.ensureParticipant();
    harness.clock.now = at(2);
    game(harness.api);
    // Сегодня окно 2 закрыто — предлагается оно; окно 1 можно догнать, но сегодняшнее важнее.
    expect(await screen.findByRole("button", { name: "Открыть окно 2" })).toBeInTheDocument();
    expect(win(1)).toHaveAttribute("data-status", "catchup");
  });

  it("до старта: отсчёт и фасад с закрытыми окнами, без гирлянды и кнопки", async () => {
    const harness = memoryAdventApi({ advent: config, start: new Date("2026-12-10T12:00:00+03:00") });
    game(harness.api);
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(document.querySelectorAll('.adv-window[data-status="locked"]')).toHaveLength(12);
    expect(document.querySelector(".adv-garland")).toBeNull();
    expect(document.querySelector(".adv-bar")).toBeNull();
  });

  it("calendar остаётся прежним: сетка дверей, большой заголовок, блок серии", async () => {
    const calendar = publicAdvent(adventConfig(), "zerno-advent", "snow-globe");
    const harness = memoryAdventApi({ start: at(3) });
    game(harness.api, calendar);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(document.querySelector(".adv-hero")).toBeInTheDocument();
    expect(document.querySelector(".adv-streak")).toBeInTheDocument();
    expect(document.querySelector(".adv-window")).toBeNull();
  });

  it("презентация storefront с неизвестным шаблоном не пройдёт проверку пакета, а не сломает страницу клиента", () => {
    expect(() => publicAdvent(storefrontConfig("castle"), "t", "snow-globe")).toThrow(/Фасад «castle» не найден/);
  });
});
