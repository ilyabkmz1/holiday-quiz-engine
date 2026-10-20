// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ColumnChart, DaysChart, niceMax } from "@/app/admin/advent-charts";
import { CohortTable, FunnelList, KpiTiles, TeamsTable } from "@/app/admin/AdventSections";

import { analyticsFixture, dayRow } from "../support/analytics-fixture";

afterEach(cleanup);

describe("niceMax", () => {
  it("верх оси — 1, 2, 5 или 10 × 10ⁿ, не меньше значения", () => {
    expect([0, 1, 3, 7, 11, 120, 460].map(niceMax)).toEqual([1, 1, 5, 10, 20, 200, 500]);
  });
});

describe("DaysChart", () => {
  const days = [
    dayRow(1, { onTime: 40, caughtUp: 5, opened: 45, active: 50, missed: 5, onTimeShare: 0.8, completed: 30 }),
    dayRow(2, { onTime: 20, caughtUp: 10, opened: 30, active: 60, missed: 30, onTimeShare: 20 / 60, completed: 12 }),
    dayRow(3, { status: "future", missed: null })
  ];

  it("подписи осей, легенда из трёх серий и описание для скринридера", () => {
    render(<DaysChart days={days} />);
    const chart = screen.getByRole("img", { name: /Столбчатая диаграмма по дням кампании/ });
    expect(chart.getAttribute("aria-label")).toContain("день 1: в свой день 40, догнали 5, пропустили 5");
    expect(chart.getAttribute("aria-label")).toContain("день 2: в свой день 20, догнали 10, пропустили 30");
    // Будущий день в описание не попадает.
    expect(chart.getAttribute("aria-label")).not.toContain("день 3");
    expect(within(chart).getByText("День кампании")).toBeInTheDocument();
    expect(within(chart).getByText("Участников")).toBeInTheDocument();
    for (const label of ["Открыли в свой день", "Догнали позже", "Пропустили (из активных)"]) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("у каждого дня подсказка с числами, а таблица к графику повторяет их", () => {
    const { container } = render(<DaysChart days={days} />);
    const titles = [...container.querySelectorAll("title")].map((node) => node.textContent);
    expect(titles[0]).toContain("в свой день 40, догнали 5, пропустили 5");
    expect(titles[2]).not.toContain("пропустили");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("row", { name: /2\. День 2/ })).toHaveTextContent("20");
    // Будущее окно — прочерки вместо нулей.
    expect(within(table).getByRole("row", { name: /3\. День 3/ })).toHaveTextContent("—");
  });

  it("серии различаются не только цветом: у пропущенных штриховка, у средней — светлота", () => {
    const { container } = render(<DaysChart days={days} id="t" />);
    expect(container.querySelector("pattern#t-hatch")).not.toBeNull();
    expect(container.querySelector(".ac-s3")?.getAttribute("fill")).toBe("url(#t-hatch)");
    expect(container.querySelector(".ac-s1")).not.toBeNull();
    expect(container.querySelector(".ac-s2")).not.toBeNull();
  });

  it("высота столбцов пропорциональна числам", () => {
    const { container } = render(<DaysChart days={[dayRow(1, { onTime: 100, missed: 0 }), dayRow(2, { onTime: 50, missed: 0 })]} />);
    const heights = [...container.querySelectorAll("path.ac-s1")].map((path) => {
      const match = /M[\d.]+ ([\d.]+)V([\d.]+)/.exec(path.getAttribute("d")!)!;
      return Number(match[1]) - Number(match[2]) + 4; // от базы до верха минус скругление
    });
    expect(heights[0] / heights[1]).toBeCloseTo(2, 1);
  });

  it("пустая кампания не ломает график", () => {
    render(<DaysChart days={[dayRow(1), dayRow(2)]} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});

describe("ColumnChart", () => {
  it("гистограмма с подписями и таблицей с долями", () => {
    render(<ColumnChart id="c" buckets={[{ value: 1, count: 30 }, { value: 4, count: 70 }]} caption="Двери" xLabel="Открыто дверей" valueHeader="Дверей" />);
    expect(screen.getByRole("img", { name: /Двери\. Открыто дверей — число участников\. 1: 30; 4: 70/ })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /4/ })).toHaveTextContent("70%");
  });

  it("нет данных — текст вместо пустого графика", () => {
    render(<ColumnChart id="c" buckets={[]} caption="Двери" xLabel="x" valueHeader="v" />);
    expect(screen.getByText("Пока нет данных.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("секции метрик", () => {
  it("плитки: прочерк, пока нет основания, и подписи", () => {
    const data = analyticsFixture();
    data.kpis.d7 = { count: 0, base: 0, share: null };
    render(<KpiTiles data={data} />);
    expect(screen.getByText("Возврат D7").closest("div")).toHaveTextContent("—");
    expect(screen.getByText("Возврат D1").closest("div")).toHaveTextContent("30%");
    expect(screen.getByText("Подписчики")).toBeInTheDocument();
  });

  it("когорты: малые скрыты, несозревшие — прочерк, цвет не единственный носитель значения", () => {
    const data = analyticsFixture({ cohorts: { offsets: [1, 7], rows: [
      { date: "2026-12-20", size: null, hidden: true, cells: [{ offset: 1, count: null, share: null }, { offset: 7, count: null, share: null }] },
      { date: "2026-12-21", size: 40, hidden: false, cells: [{ offset: 1, count: 20, share: 0.5 }, { offset: 7, count: null, share: null }] }
    ] } });
    render(<CohortTable data={data} />);
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("меньше 5");
    expect(rows[2]).toHaveTextContent("50%");
    expect(rows[2]).toHaveTextContent("20");
    expect(rows[2].querySelectorAll("td")[2]).toHaveTextContent("—");
  });

  it("воронка и команды: скрытая команда без цифр", () => {
    render(<FunnelList caption="Воронка" base={100} steps={[{ key: "a", label: "Все", count: 100, share: 1 }, { key: "b", label: "Email", count: 25, share: 0.25 }]} />);
    expect(screen.getByRole("list", { name: "Воронка" })).toHaveTextContent("25%");
    cleanup();
    const data = analyticsFixture({ teams: [
      { id: "a", title: "Север", hidden: false, members: 10, players: 8, avgDoors: 4.25, activeShare: 0.8, points: 400, avgPoints: 40, rank: 1 },
      { id: "b", title: "Юг", hidden: true, members: null, players: null, avgDoors: null, activeShare: null, points: null, avgPoints: null, rank: null }
    ] });
    render(<TeamsTable data={data} />);
    expect(screen.getByRole("row", { name: /Север/ })).toHaveTextContent("4,3");
    expect(screen.getByRole("row", { name: /Юг/ })).toHaveTextContent("меньше 5 участников");
    expect(screen.getByRole("row", { name: /Юг/ })).not.toHaveTextContent("0");
  });
});
