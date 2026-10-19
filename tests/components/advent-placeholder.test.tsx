// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdventPlaceholder, startDateLabel } from "@/components/advent/AdventPlaceholder";

import { adventConfig } from "../support/advent";

afterEach(cleanup);

describe("AdventPlaceholder (заглушка до A3)", () => {
  const advent = adventConfig();

  it("до старта: название, бренд и дата открытия", () => {
    render(<AdventPlaceholder advent={advent} now={new Date("2026-12-10T12:00:00+03:00")} />);
    expect(screen.getByRole("heading", { level: 1, name: advent.title })).toBeInTheDocument();
    expect(screen.getByText("Адвент откроется 20 декабря.")).toBeInTheDocument();
    expect(screen.getByText(advent.brand.topNote)).toBeInTheDocument();
  });

  it("после старта сообщает, что адвент идёт", () => {
    render(<AdventPlaceholder advent={advent} now={new Date("2026-12-22T12:00:00+03:00")} />);
    expect(screen.queryByText(/откроется/)).not.toBeInTheDocument();
    expect(screen.getByText(/уже идёт/)).toBeInTheDocument();
  });

  it("дата старта считается в часовом поясе кампании", () => {
    expect(startDateLabel(advent)).toBe("20 декабря");
    // В Нью-Йорке 20 декабря 00:00 — это 21 декабря по Москве, но подпись остаётся локальной датой кампании.
    expect(startDateLabel(adventConfig((draft) => { draft.schedule.timezone = "America/New_York"; }))).toBe("20 декабря");
  });
});
