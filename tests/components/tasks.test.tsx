// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderInWorld as render } from "./world-render";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RevealPanel } from "@/components/game/RevealPanel";
import { AccessTask } from "@/components/game/tasks/AccessTask";
import { BuildTask } from "@/components/game/tasks/BuildTask";
import { OrderTask } from "@/components/game/tasks/OrderTask";
import { PhishTask } from "@/components/game/tasks/PhishTask";
import { PickTask } from "@/components/game/tasks/PickTask";
import type { PublicHero, PublicRoom, PublicTask, TaskReveal } from "@/types/api";

afterEach(cleanup);

const hero: PublicHero = { id: "marina", name: "Марина", role: "директор", color: "#FFD27A" };
const room: PublicRoom = {
  id: "mail", title: "Почтовая", eyebrow: "Зона 1 · Почта", description: "", icon: "mail",
  ornament: "Конверт", color: "#62E0FF", map: { x: 10, y: 10 }, hostId: "marina", spotId: "mail", taskIds: []
};
const card = (id: string, title: string) => ({ id, title, icon: "mail" });
const base = { id: "t", roomId: "mail", heroId: "marina", say: "Реплика героя" };

const pick: Extract<PublicTask, { type: "pick" }> = { ...base, type: "pick", options: [card("a", "Первая"), card("b", "Вторая"), card("c", "Третья")] };
const build: Extract<PublicTask, { type: "build" }> = { ...base, type: "build", slots: 2, options: [card("a", "Альфа"), card("b", "Бета"), card("c", "Гамма")] };
const phish: Extract<PublicTask, { type: "phish" }> = {
  ...base, type: "phish",
  letters: [
    { id: "l1", sender: "Первый", address: "one@x.ru", subject: "Тема 1", mark: "verified" as const, attachment: null },
    { id: "l2", sender: "Второй", address: "two@x.ru.co", subject: "Тема 2", mark: "none" as const, attachment: "a.exe" }
  ]
};
const access: Extract<PublicTask, { type: "access" }> = { ...base, type: "access", switches: [card("p", "Пароль"), card("l", "Лимит"), card("w", "Всем")] };
const order: Extract<PublicTask, { type: "order" }> = { ...base, type: "order", items: [card("x", "Шаг X"), card("y", "Шаг Y"), card("z", "Шаг Z")] };

function reveal(overrides: Partial<TaskReveal>): TaskReveal {
  return {
    taskId: "t", roomId: "mail", type: "pick", payload: { optionId: "a" }, base: 0, comboBonus: 0, combo: 0,
    outcome: "miss", correctIds: ["b"], explanation: "Объяснение", tip: "Совет робота", mood: "sad",
    line: "Реплика после", fuses: 2, answeredAt: new Date().toISOString(), ...overrides
  };
}

type Wrap = (props: Record<string, unknown>) => ReactNode;
function mount(task: PublicTask, View: Wrap, extra: { reveal?: TaskReveal | null; disabled?: boolean } = {}) {
  const onSubmit = vi.fn();
  const props = { task, hero, room, reveal: extra.reveal ?? null, disabled: extra.disabled ?? false, onSubmit, after: <p>Панель разбора</p>, shake: false };
  render(View(props));
  return onSubmit;
}

describe("pick", () => {
  const view: Wrap = (p) => <PickTask {...(p as Parameters<typeof PickTask>[0])} />;

  it("отправляет выбранную карточку и не принимает второй тап", () => {
    const onSubmit = mount(pick, view);
    fireEvent.click(screen.getByRole("button", { name: "Вторая" }));
    fireEvent.click(screen.getByRole("button", { name: "Вторая" }));
    fireEvent.click(screen.getByRole("button", { name: "Первая" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ optionId: "b" });
  });

  it("выбирает цифровой клавишей", () => {
    const onSubmit = mount(pick, view);
    fireEvent.keyDown(window, { key: "3" });
    expect(onSubmit).toHaveBeenCalledWith({ optionId: "c" });
  });

  it("при разборе вместо карточек показывает панель разбора и реплику героя", () => {
    mount(pick, view, { reveal: reveal({}) });
    expect(screen.queryByRole("button", { name: "Первая" })).toBeNull();
    expect(screen.getByText("Панель разбора")).toBeInTheDocument();
    expect(screen.getByText("Реплика после")).toBeInTheDocument();
  });

  it("блокирует карточки, пока отправляется ответ", () => {
    mount(pick, view, { disabled: true });
    expect(screen.getByRole("button", { name: "Первая" })).toBeDisabled();
  });
});

describe("build", () => {
  const view: Wrap = (p) => <BuildTask {...(p as Parameters<typeof BuildTask>[0])} />;

  it("заполняет слоты по очереди, снимает карточку слотом и отправляет по кнопке", () => {
    const onSubmit = mount(build, view);
    const launch = screen.getByRole("button", { name: /^Запустить сценарий/ });
    expect(launch).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Бета" }));
    fireEvent.click(screen.getByRole("button", { name: "Альфа" }));
    expect(screen.getByRole("group", { name: "Сценарий: выбрано 2 из 2" })).toBeInTheDocument();
    // Третью карточку положить некуда.
    fireEvent.click(screen.getByRole("button", { name: "Гамма" }));
    expect(screen.getByRole("group", { name: "Сценарий: выбрано 2 из 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Убрать «Бета» из сценария" }));
    expect(screen.getByRole("group", { name: "Сценарий: выбрано 1 из 2" })).toBeInTheDocument();
    expect(launch).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Гамма" }));
    fireEvent.click(launch);
    fireEvent.click(launch);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ optionIds: ["a", "c"] });
  });

  it("работает с клавиатуры: цифры выбирают карточки", () => {
    const onSubmit = mount(build, view);
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.click(screen.getByRole("button", { name: /^Запустить сценарий/ }));
    expect(onSubmit).toHaveBeenCalledWith({ optionIds: ["a", "b"] });
  });

  it("после разбора показывает принятый ответ и отмечает верные слоты", () => {
    mount(build, view, { reveal: reveal({ type: "build", payload: { optionIds: ["a", "c"] }, correctIds: ["a", "b"] }) });
    expect(screen.getByRole("button", { name: "Убрать «Альфа» из сценария" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Убрать «Альфа» из сценария" })).toHaveClass("right");
    expect(screen.getByRole("button", { name: "Убрать «Гамма» из сценария" })).toHaveClass("wrong");
    expect(screen.getByText("Панель разбора")).toBeInTheDocument();
  });
});

describe("phish", () => {
  const view: Wrap = (p) => <PhishTask {...(p as Parameters<typeof PhishTask>[0])} />;

  it("требует выбрать письмо и отправляет его один раз", () => {
    const onSubmit = mount(phish, view);
    const submit = screen.getByRole("button", { name: "Это подделка — в карантин" });
    expect(submit).toBeDisabled();
    const second = screen.getByRole("button", { name: /two@x\.ru\.co/ });
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ optionId: "l2" });
  });

  it("показывает отметку проверенного отправителя и вложение", () => {
    mount(phish, view);
    expect(screen.getByText("проверен")).toBeInTheDocument();
    expect(screen.getByText(/a\.exe/)).toBeInTheDocument();
  });

  it("после разбора письма недоступны", () => {
    mount(phish, view, { reveal: reveal({ type: "phish", payload: { optionId: "l2" }, correctIds: ["l2"] }) });
    expect(screen.queryByRole("button", { name: /one@x\.ru/ })).toBeNull();
  });
});

describe("access", () => {
  const view: Wrap = (p) => <AccessTask {...(p as Parameters<typeof AccessTask>[0])} />;

  it("переключатели имеют роль switch и меняют aria-checked с клавиатуры", () => {
    mount(access, view);
    const password = screen.getByRole("switch", { name: "Пароль" });
    expect(password).toHaveAttribute("aria-checked", "false");
    fireEvent.click(password);
    expect(password).toHaveAttribute("aria-checked", "true");
    fireEvent.click(password);
    expect(password).toHaveAttribute("aria-checked", "false");
  });

  it("отправляет включённые переключатели в порядке задания, повторно — нет", () => {
    const onSubmit = mount(access, view);
    fireEvent.click(screen.getByRole("switch", { name: "Лимит" }));
    fireEvent.click(screen.getByRole("switch", { name: "Пароль" }));
    const apply = screen.getByRole("button", { name: "Применить настройки" });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ enabledIds: ["p", "l"] });
  });

  it("допускает пустой набор", () => {
    const onSubmit = mount(access, view);
    fireEvent.click(screen.getByRole("button", { name: "Применить настройки" }));
    expect(onSubmit).toHaveBeenCalledWith({ enabledIds: [] });
  });
});

describe("order", () => {
  const view: Wrap = (p) => <OrderTask {...(p as Parameters<typeof OrderTask>[0])} />;

  it("тапы ставят карточки на позиции 1..N, сброс очищает, отправка по полному порядку", () => {
    const onSubmit = mount(order, view);
    const confirm = screen.getByRole("button", { name: /^Подтвердить/ });
    fireEvent.click(screen.getByRole("button", { name: "Шаг Z" }));
    fireEvent.click(screen.getByRole("button", { name: "Шаг X" }));
    expect(screen.getByRole("button", { name: /Шаг Z, позиция 1/ })).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(screen.getByRole("list", { name: "Выбранный порядок: 0 из 3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Шаг Y" }));
    fireEvent.click(screen.getByRole("button", { name: "Шаг X" }));
    fireEvent.click(screen.getByRole("button", { name: "Шаг Z" }));
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ orderedIds: ["y", "x", "z"] });
  });

  it("повторный тап снимает карточку; Backspace в позиции тоже", () => {
    mount(order, view);
    fireEvent.click(screen.getByRole("button", { name: "Шаг X" }));
    fireEvent.click(screen.getByRole("button", { name: /Шаг X, позиция 1/ }));
    expect(screen.getByRole("list", { name: "Выбранный порядок: 0 из 3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Шаг Y" }));
    fireEvent.keyDown(screen.getByRole("button", { name: /Позиция 1: «Шаг Y»/ }), { key: "Backspace" });
    expect(screen.getByRole("list", { name: "Выбранный порядок: 0 из 3" })).toBeInTheDocument();
  });

  it("цифры 1–3 ставят карточки в порядке нажатий", () => {
    const onSubmit = mount(order, view);
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить порядок" }));
    expect(onSubmit).toHaveBeenCalledWith({ orderedIds: ["y", "z", "x"] });
  });

  it("после разбора показывает порядок игрока с отметками верных позиций", () => {
    mount(order, view, { reveal: reveal({ type: "order", payload: { orderedIds: ["x", "z", "y"] }, correctIds: ["x", "y", "z"] }) });
    expect(screen.getByRole("button", { name: /Позиция 1: «Шаг X»/ })).toHaveClass("right");
    expect(screen.getByRole("button", { name: /Позиция 2: «Шаг Z»/ })).toHaveClass("wrong");
  });
});

describe("RevealPanel", () => {
  it("при сбое показывает верный вариант от сервера, объяснение, совет и вызывает «дальше»", () => {
    const onNext = vi.fn();
    render(<RevealPanel task={pick} reveal={reveal({})} nextLabel="Следующая заявка" busy={false} onNext={onNext} />);
    expect(screen.getByRole("heading", { name: "Сбой в офисе" })).toBeInTheDocument();
    expect(screen.getByText(/Верно: Вторая/)).toBeInTheDocument();
    expect(screen.getByText("Объяснение")).toBeInTheDocument();
    expect(screen.getByText("Совет робота")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Следующая заявка" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("при успехе с комбо показывает бонус и без блока «верно»", () => {
    render(
      <RevealPanel
        task={pick}
        reveal={reveal({ base: 100, comboBonus: 25, combo: 2, outcome: "perfect", mood: "happy", correctIds: ["a"] })}
        nextLabel="Включить свет в комнате"
        busy={false}
        onNext={() => undefined}
      />
    );
    expect(screen.getByRole("heading", { name: "Комбо! Офис разгорается" })).toBeInTheDocument();
    expect(screen.getByText("Комбо ×2: +25")).toBeInTheDocument();
    expect(screen.queryByText(/Верно:/)).toBeNull();
  });

  it("для access называет включённые переключатели", () => {
    render(
      <RevealPanel task={access} reveal={reveal({ type: "access", correctIds: ["p", "l"] })} nextLabel="Дальше" busy={false} onNext={() => undefined} />
    );
    expect(screen.getByText(/включить: Пароль, Лимит/)).toBeInTheDocument();
  });
});
