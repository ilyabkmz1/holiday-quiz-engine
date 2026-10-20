// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LUCK_REVEAL_MS, LuckReveal, type LuckPhase, type LuckSkin } from "@/components/advent/LuckReveal";
import type { AdventGrantView } from "@/types/advent";

import { config } from "../support/advent-ui";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => vi.useFakeTimers());

const result: AdventGrantView = {
  id: "g1", source: "luck", day: 4, rewardId: "luck-b", kind: "gift", label: "Кофе в подарок", description: "", icon: "cup", status: "issued",
  expiresAt: null, code: "TOP12", grantedAt: "2026-12-23T09:00:00.000Z", redeemedAt: null, redeem: "cashier", url: null, needsIdentity: false, codePending: false, qr: null
};

function mount(skin: LuckSkin, phase: LuckPhase, extra: { chosen?: number | null; result?: AdventGrantView | null; reduced?: boolean; choices?: number; onChoose?: (index: number) => void } = {}) {
  const onChoose = extra.onChoose ?? vi.fn();
  const view = (props: { phase: LuckPhase; chosen: number | null; result: AdventGrantView | null }) => (
    <LuckReveal skin={skin} choices={extra.choices ?? 3} copy={config.copy} reduced={extra.reduced ?? false} onChoose={onChoose} {...props}>
      <p>после раскрытия</p>
    </LuckReveal>
  );
  const utils = render(view({ phase, chosen: extra.chosen ?? null, result: extra.result ?? null }));
  return { ...utils, onChoose, rerenderWith: (props: { phase: LuckPhase; chosen: number | null; result: AdventGrantView | null }) => utils.rerender(view(props)) };
}

describe.each<LuckSkin>(["boxes", "wheel", "scratch"])("LuckReveal: скин %s", (skin) => {
  const pickLabel = { boxes: /^Коробка 2/, wheel: /^Сектор 2/, scratch: /^Карточка 2/ }[skin];

  it("до выбора: элементы доступны, исхода и подсказок о призах нет", () => {
    mount(skin, "choose");
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByText(result.label)).not.toBeInTheDocument();
    expect(screen.queryByText(config.copy.luckWon)).not.toBeInTheDocument();
  });

  it("выбор вызывает onChoose с индексом, на исход он не влияет (в компоненте исхода нет)", () => {
    const { onChoose } = mount(skin, "choose");
    fireEvent.click(screen.getByRole("button", { name: pickLabel }));
    expect(onChoose).toHaveBeenCalledWith(1);
  });

  it("пока сервер не ответил (pending): исхода нет, элементы заблокированы, анимации раскрытия нет", () => {
    mount(skin, "pending", { chosen: 1 });
    expect(screen.queryByText(result.label)).not.toBeInTheDocument();
    expect(screen.queryByText(config.copy.luckWon)).not.toBeInTheDocument();
    expect(document.querySelector('[data-state="open"]')).toBeNull();
    for (const button of screen.queryAllByRole("button")) expect(button).toBeDisabled();
    expect(document.querySelector(".adv-luck")).toHaveAttribute("data-phase", "pending");
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.queryByText(result.label)).not.toBeInTheDocument();
  });

  it("ответ сервера: раскрытие длится заданное время, и только потом виден исход", () => {
    const view = mount(skin, "pending", { chosen: 1 });
    view.rerenderWith({ phase: "reveal", chosen: 1, result });
    expect(document.querySelector(".adv-luck")).toHaveAttribute("data-phase", "reveal");
    expect(screen.queryByText(config.copy.luckWon)).not.toBeInTheDocument();
    expect(screen.queryByText("после раскрытия")).not.toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(LUCK_REVEAL_MS[skin] - 50));
    expect(screen.queryByText(config.copy.luckWon)).not.toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByText(config.copy.luckWon)).toBeInTheDocument();
    expect(screen.getAllByText(result.label).length).toBeGreaterThan(0);
    expect(screen.getByText("после раскрытия")).toBeInTheDocument();
  });

  it("prefers-reduced-motion: исход виден сразу, без ожидания анимации", () => {
    const view = mount(skin, "pending", { chosen: 1, reduced: true });
    view.rerenderWith({ phase: "reveal", chosen: 1, result });
    expect(screen.getByText(config.copy.luckWon)).toBeInTheDocument();
    expect(screen.getAllByText(result.label).length).toBeGreaterThan(0);
    expect(document.querySelector(".adv-burst")).toBeNull();
    expect(screen.getByText("после раскрытия")).toBeInTheDocument();
  });

  it("исход показывает только выбранный элемент, остальные остаются закрытыми и не раскрывают содержимое", () => {
    const view = mount(skin, "pending", { chosen: 1 });
    view.rerenderWith({ phase: "reveal", chosen: 1, result });
    act(() => void vi.advanceTimersByTime(LUCK_REVEAL_MS[skin] + 100));
    if (skin !== "wheel") {
      const items = [...document.querySelectorAll<HTMLElement>(".adv-luck-item")];
      expect(items.map((item) => item.dataset.state)).toEqual(["dim", "open", "dim"]);
    }
    expect(screen.getAllByText(result.label).length).toBeGreaterThan(0);
    expect(screen.queryByText("Печенье к кофе")).not.toBeInTheDocument();
  });
});

describe("LuckReveal: число вариантов и колесо", () => {
  it("число элементов равно choices (3–6)", () => {
    mount("boxes", "choose", { choices: 6 });
    expect(screen.getAllByRole("button")).toHaveLength(6);
  });

  it("колесо стартует с нуля и поворачивается только после ответа сервера на сектор выбранного индекса", () => {
    const view = mount("wheel", "pending", { chosen: 2, choices: 4 });
    const wheel = document.querySelector<SVGElement>(".adv-wheel")!;
    expect(wheel.style.transform).toBe("rotate(0deg)");
    view.rerenderWith({ phase: "reveal", chosen: 2, result });
    // 4 оборота минус угол сектора 2 из 4: указатель наверху остановится на выбранном секторе.
    expect(wheel.style.transform).toBe(`rotate(${360 * 4 - 2 * 90}deg)`);
  });

  it("колесо при reduced-motion не вращается (без оборотов и перехода), но стоит на выбранном секторе; результат сразу", () => {
    const view = mount("wheel", "pending", { chosen: 2, choices: 4, reduced: true });
    view.rerenderWith({ phase: "reveal", chosen: 2, result });
    const wheel = document.querySelector<SVGElement>(".adv-wheel")!;
    expect(wheel.style.transform).toBe(`rotate(${-2 * 90}deg)`);
    expect(wheel.style.transitionDuration).toBe("0s");
    expect(screen.getAllByText(result.label).length).toBeGreaterThan(0);
  });

  it("после выбора фокус не теряется: переходит на блок удачи", () => {
    const view = mount("boxes", "choose", { chosen: null });
    const box = screen.getAllByRole("button")[1];
    box.focus();
    view.rerenderWith({ phase: "pending", chosen: 1, result: null });
    expect(document.activeElement).toBe(document.querySelector(".adv-luck"));
  });

  it("новый исход (другая выдача) снова проходит раскрытие", () => {
    const view = mount("boxes", "reveal", { chosen: 0, result });
    act(() => void vi.advanceTimersByTime(LUCK_REVEAL_MS.boxes + 100));
    expect(screen.getAllByText(result.label).length).toBeGreaterThan(0);
    view.rerenderWith({ phase: "reveal", chosen: 0, result: { ...result, id: "g2", label: "Печенье к кофе" } });
    expect(screen.queryByText("Печенье к кофе")).not.toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(LUCK_REVEAL_MS.boxes + 100));
    expect(screen.getAllByText("Печенье к кофе").length).toBeGreaterThan(0);
  });
});
