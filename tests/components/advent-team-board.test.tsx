// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdventGame } from "@/components/advent/AdventGame";
import { ApiError } from "@/components/advent/api";
import { TeamBoard } from "@/components/advent/TeamBoard";
import { publicAdvent } from "@/server/presentation";
import type { AdventState } from "@/types/advent";

import { adventConfig, at } from "../support/advent";
import { memoryAdventApi } from "../support/advent-client";
import { mockReducedMotion } from "../support/advent-ui";
import { snowGlobe } from "../support/world";

const TEAMS = [
  { id: "t-north", title: "Север" },
  { id: "t-south", title: "Юг" },
  { id: "t-east", title: "Восток" }
];
const config = adventConfig((draft) => {
  draft.audience = { kind: "employees", leaderboard: "teams", teams: TEAMS };
});
const publicConfig = publicAdvent(config, "zerno-advent", "snow-globe");
const copy = config.copy;

beforeEach(() => {
  mockReducedMotion(false);
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Коллеги по командам: участники сервиса в памяти, у каждого своя команда и число открытых дверей. */
async function colleagues(harness: ReturnType<typeof memoryAdventApi>, plan: Array<[string, number, number]>) {
  for (const [teamId, count, doors] of plan) {
    for (let index = 0; index < count; index += 1) {
      const { participant } = await harness.ctx.service.createParticipant(at(1, 9));
      await harness.ctx.service.setTeam(participant.id, teamId, at(1, 9));
      for (let day = 1; day <= doors; day += 1) await harness.ctx.service.openDay(participant.id, day, at(day, 10));
    }
  }
}

function Harness({ harness, initial }: { harness: ReturnType<typeof memoryAdventApi>; initial: AdventState }) {
  const [state, setState] = useState(initial);
  return <TeamBoard copy={copy} state={state} api={harness.api} onState={setState} />;
}

async function mountBoard(plan: Array<[string, number, number]>, start = at(4, 12)) {
  const harness = memoryAdventApi({ advent: config, start });
  await colleagues(harness, plan);
  await harness.ensureParticipant();
  render(<Harness harness={harness} initial={await harness.api.getState()} />);
  return harness;
}

describe("TeamBoard", () => {
  it("рейтинг по среднему: места, цифры, малая команда без цифр; участник ещё не выбрал команду", async () => {
    await mountBoard([["t-north", 3, 3], ["t-south", 4, 4], ["t-east", 2, 4]]);
    const list = await screen.findByRole("list", { name: copy.teamTableLabel });
    const rows = within(list).getAllByRole("listitem");
    // Юг (4,0 на участника) впереди Севера (3,0); Восток — двое, цифр нет.
    expect(rows.map((row) => row.querySelector(".adv-team-name")?.textContent)).toEqual(["Юг", "Север", "Восток"]);
    expect(rows[0]).toHaveTextContent("4,0 открытых на участника");
    expect(rows[0]).toHaveTextContent("Участников: 4");
    expect(rows[0]).toHaveTextContent("Играют 100%");
    expect(rows[1]).toHaveTextContent("3,0 открытых на участника");
    expect(rows[2]).toHaveTextContent(copy.teamHidden);
    expect(rows[2]).not.toHaveTextContent("открытых на участника");
    // Ни имён людей, ни идентификаторов на экране.
    expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    // Выбор — радиогруппа с подписью.
    const group = screen.getByRole("group", { name: copy.teamPickLegend });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(within(group).getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
  });

  it("выбор команды сохраняется, подсвечивается и обновляет рейтинг; «не участвовать» снимает", async () => {
    const harness = await mountBoard([["t-north", 3, 2]]);
    const setTeam = vi.spyOn(harness.api, "setTeam");
    await screen.findByRole("list", { name: copy.teamTableLabel });
    fireEvent.click(screen.getByRole("radio", { name: "Север" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Север" })).toBeChecked());
    expect(setTeam).toHaveBeenCalledWith("t-north");
    // Теперь в команде четверо: рейтинг перезапрашивается (кэш сервера — в пределах трёх минут, но выбор участника сдвигает `mine`).
    expect(await screen.findByText(copy.teamMine)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.teamLeave }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Север" })).not.toBeChecked());
    expect(setTeam).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText(copy.teamMine)).toBeNull();
  });

  it("клавиатура: радиокнопки доступны с фокусом, выбор — по пробелу (клик по метке)", async () => {
    await mountBoard([["t-north", 3, 1]]);
    await screen.findByRole("list", { name: copy.teamTableLabel });
    const radio = screen.getByRole("radio", { name: "Юг" });
    radio.focus();
    expect(radio).toHaveFocus();
    expect(radio).not.toHaveAttribute("disabled");
    fireEvent.click(radio);
    await waitFor(() => expect(radio).toBeChecked());
  });

  it("ошибка сохранения и ошибка загрузки рейтинга читаются (role=alert)", async () => {
    const harness = await mountBoard([["t-north", 3, 1]]);
    await screen.findByRole("list", { name: copy.teamTableLabel });
    vi.spyOn(harness.api, "setTeam").mockRejectedValueOnce(new ApiError(500, "boom"));
    fireEvent.click(screen.getByRole("radio", { name: "Юг" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.teamSaveError);
    expect(screen.getByRole("radio", { name: "Юг" })).not.toBeChecked();
    cleanup();
    const failing = memoryAdventApi({ advent: config });
    await failing.ensureParticipant();
    vi.spyOn(failing.api, "getLeaderboard").mockRejectedValue(new ApiError(500, "boom"));
    render(<Harness harness={failing} initial={await failing.api.getState()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.teamLoadError);
  });

  it("после финала выбирать команду нельзя, рейтинг остаётся", async () => {
    await mountBoard([["t-north", 3, 2]], new Date("2027-01-01T12:00:00+03:00"));
    await screen.findByRole("list", { name: copy.teamTableLabel });
    expect(screen.queryByRole("group", { name: copy.teamPickLegend })).toBeNull();
  });

  it("нет команд в кампании — компонент ничего не рисует", async () => {
    const plain = memoryAdventApi({ start: at(2) });
    await plain.ensureParticipant();
    const { container } = render(<TeamBoard copy={copy} state={await plain.api.getState()} api={plain.api} onState={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("prefers-reduced-motion: рейтинг без анимаций (стили не вешают анимации на полоски)", async () => {
    mockReducedMotion(true);
    await mountBoard([["t-north", 3, 2]]);
    const bar = (await screen.findAllByText((_, element) => element?.classList.contains("adv-team-bar") ?? false))[0];
    expect(bar).toBeInTheDocument();
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/components/advent/advent.css", "utf8");
    const block = css.slice(css.indexOf("Командный зачёт (A7)"));
    expect(block).not.toMatch(/animation:|@keyframes/);
  });
});

describe("AdventGame с командами", () => {
  it("в календаре виден командный зачёт; выбор команды доходит до сервера", async () => {
    const harness = memoryAdventApi({ advent: config, start: at(4, 12) });
    await colleagues(harness, [["t-north", 3, 2]]);
    render(<AdventGame advent={publicConfig} world={snowGlobe} api={harness.api} />);
    expect(await screen.findByRole("heading", { name: copy.teamTitle })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("radio", { name: "Север" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Север" })).toBeChecked());
    const state = await harness.api.getState();
    expect(state.team?.selected).toBe("t-north");
  });

  it("в финале рейтинг показан без выбора", async () => {
    const harness = memoryAdventApi({ advent: config, start: new Date("2027-01-01T12:00:00+03:00") });
    await colleagues(harness, [["t-north", 3, 2]]);
    render(<AdventGame advent={publicConfig} world={snowGlobe} api={harness.api} />);
    expect(await screen.findByRole("heading", { name: copy.teamTitle })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: copy.teamPickLegend })).toBeNull();
  });

  it("без рейтинга по командам блока нет", async () => {
    const harness = memoryAdventApi({ start: at(4, 12) });
    render(<AdventGame advent={publicAdvent(adventConfig(), "zerno-advent", "snow-globe")} world={snowGlobe} api={harness.api} />);
    await waitFor(() => expect(document.querySelectorAll(".adv-door")).toHaveLength(12));
    expect(screen.queryByRole("heading", { name: copy.teamTitle })).toBeNull();
  });
});
