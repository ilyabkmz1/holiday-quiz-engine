import { describe, expect, it } from "vitest";

import { FACADE_COLUMNS, RACK_COLUMNS, RACK_DOOR_ROWS, facadeLayout, type FacadeCell, type FacadeLayout } from "@/domain/advent";

const withAttic = { layout: { attic: true } };
const noAttic = { layout: { attic: false } };

/** Клетки в половинках колонки: так видны и целые, и сдвинутые на 0,5 колонки места. */
function footprint(cell: FacadeCell): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
    for (let half = cell.col * 2; half < (cell.col + cell.colSpan) * 2; half += 1) cells.push([row, half]);
  }
  return cells;
}

function expectSound(layout: FacadeLayout, days: number, today: number | null, attic: boolean) {
  const label = `дней ${days}, сегодня ${today}, мансарда ${attic}`;
  const windows = layout.cells.filter((cell) => cell.kind !== "door");
  // Каждое окно ровно один раз.
  expect(windows.map((cell) => cell.n).sort((a, b) => a! - b!), label).toEqual(Array.from({ length: days }, (_, index) => index + 1));
  // Дверь одна и по центру шириной 2 колонки.
  const doors = layout.cells.filter((cell) => cell.kind === "door");
  expect(doors, label).toHaveLength(1);
  expect(doors[0], label).toMatchObject({ col: 1, colSpan: 2, rowSpan: 1, n: null });
  // Без перекрытий и в границах сетки.
  const taken = new Set<string>();
  for (const cell of layout.cells) {
    expect(cell.col, label).toBeGreaterThanOrEqual(0);
    expect(cell.col + cell.colSpan, label).toBeLessThanOrEqual(FACADE_COLUMNS);
    expect(cell.row + cell.rowSpan, label).toBeLessThanOrEqual(layout.rows);
    for (const [row, half] of footprint(cell)) {
      const key = `${row}:${half}`;
      expect(taken.has(key), `${label}: перекрытие в ${key}`).toBe(false);
      taken.add(key);
    }
  }
  // Сегодняшнее окно — 2×2, остальные 1×1; финал в мансарде шириной 2 колонки по центру.
  const big = windows.filter((cell) => cell.big);
  expect(big.map((cell) => cell.n), label).toEqual(today !== null && today >= 1 && today <= days ? [today] : []);
  for (const cell of big) expect(cell.rowSpan, label).toBe(2);
  for (const cell of big) expect(cell.colSpan, label).toBe(2);
  for (const cell of windows.filter((candidate) => !candidate.big && candidate.kind === "window")) expect(cell, label).toMatchObject({ colSpan: 1, rowSpan: 1 });
  const finale = windows.find((cell) => cell.n === days)!;
  if (attic && days >= 3) expect(finale, label).toMatchObject({ kind: "attic", col: 1, colSpan: 2, row: 0 });
  else expect(finale.kind, label).toBe("window");
  // Дверь внизу: ниже неё ничего нет.
  expect(doors[0].row + 1, label).toBe(layout.rows);
  for (const cell of windows) expect(cell.row + cell.rowSpan, label).toBeLessThanOrEqual(doors[0].row + (cell.row === doors[0].row ? 1 : 0));
}

describe("facadeLayout: раскладка окон фасада", () => {
  const todays = (days: number): Array<number | null> => [null, 0, ...Array.from({ length: days }, (_, index) => index + 1), days + 1];

  for (let days = 5; days <= 31; days += 1) {
    it(`${days} дней: каждое окно один раз, без перекрытий и выхода за сетку при каждом «сегодня»`, () => {
      for (const attic of [true, false]) {
        for (const today of todays(days)) expectSound(facadeLayout(days, today, attic ? withAttic : noAttic), days, today, attic);
      }
    });
  }

  it("12 дней, сегодня 6: мансарда с финалом, сегодня 2×2, дверь по центру внизу", () => {
    const layout = facadeLayout(12, 6, withAttic);
    expect(layout.columns).toBe(4);
    const cell = (n: number) => layout.cells.find((candidate) => candidate.n === n)!;
    expect(cell(12)).toMatchObject({ kind: "attic", col: 1, row: 0, colSpan: 2, rowSpan: 1 });
    expect(cell(6)).toMatchObject({ kind: "window", colSpan: 2, rowSpan: 2, big: true });
    // Окна до сегодняшнего стоят раньше по рядам, после — позже.
    expect(cell(5).row).toBeLessThanOrEqual(cell(6).row);
    expect(cell(7).row).toBeGreaterThanOrEqual(cell(6).row);
    expect(layout.rows).toBeLessThanOrEqual(6);
  });

  it("12 дней до старта и после финала: большого окна нет, все окна одинаковые", () => {
    for (const today of [null, 0, 13]) {
      const layout = facadeLayout(12, today, withAttic);
      expect(layout.cells.some((cell) => cell.big)).toBe(false);
    }
  });

  it("сегодня — последний день: мансарда занимает 2 колонки на 2 ряда", () => {
    const layout = facadeLayout(12, 12, withAttic);
    expect(layout.cells.find((cell) => cell.n === 12)).toMatchObject({ kind: "attic", rowSpan: 2, colSpan: 2, big: true });
  });

  it("окна неполного последнего ряда уходят к двери: одно или два по бокам, три — по центру ряда", () => {
    // 5 дней: мансарда + окна 1–4: полный ряд, дверь отдельно.
    expect(facadeLayout(5, null, withAttic).rows).toBe(3);
    // 7 дней: окна 1–6 → ряд 4 и два окна у двери.
    const seven = facadeLayout(7, null, withAttic);
    const door = seven.cells.find((cell) => cell.kind === "door")!;
    const flank = seven.cells.filter((cell) => cell.kind === "window" && cell.row === door.row);
    expect(flank.map((cell) => cell.col).sort()).toEqual([0, 3]);
    // 12 дней без сегодняшнего: окна 1–11 → 4 + 4 + три по центру, дверь отдельным рядом.
    const twelve = facadeLayout(12, null, withAttic);
    const middle = twelve.cells.filter((cell) => cell.row === 3 && cell.kind === "window");
    expect(middle.map((cell) => cell.col).sort()).toEqual([0.5, 1.5, 2.5]);
  });

  it("высота растёт с числом дней: 31 день выше 12", () => {
    expect(facadeLayout(31, null, withAttic).rows).toBeGreaterThan(facadeLayout(12, null, withAttic).rows);
    expect(facadeLayout(24, null, withAttic).rows).toBeGreaterThan(facadeLayout(12, null, withAttic).rows);
  });

  it("раскладка детерминирована и не меняет шаблон", () => {
    const template = { layout: { attic: true } };
    const first = facadeLayout(12, 6, template);
    expect(facadeLayout(12, 6, template)).toEqual(first);
    expect(template).toEqual({ layout: { attic: true } });
  });

  it("число дней должно быть целым от 1", () => {
    expect(() => facadeLayout(0, null, withAttic)).toThrow();
    expect(() => facadeLayout(2.5, null, withAttic)).toThrow();
  });
});

describe("facadeLayout: стойка (layout.columns: 2)", () => {
  const rack = { layout: { attic: true, columns: 2 as const } };
  const rackNoAttic = { layout: { attic: false, columns: 2 as const } };

  it("для любого числа дней 5–31 и любого сегодняшнего дня: каждое окно один раз, без перекрытий и дыр, дверь внизу по центру", () => {
    for (const attic of [true, false]) {
      for (let days = 5; days <= 31; days += 1) {
        for (const today of [null, ...Array.from({ length: days }, (_, index) => index + 1)]) {
          const label = `дней ${days}, сегодня ${today}, мансарда ${attic}`;
          const layout = facadeLayout(days, today, attic ? rack : rackNoAttic);
          expect(layout.columns, label).toBe(RACK_COLUMNS);
          const windows = layout.cells.filter((cell) => cell.kind !== "door");
          expect(windows.map((cell) => cell.n).sort((a, b) => a! - b!), label).toEqual(Array.from({ length: days }, (_, index) => index + 1));
          const door = layout.cells.find((cell) => cell.kind === "door")!;
          expect(door, label).toMatchObject({ col: 0.5, colSpan: 1, rowSpan: RACK_DOOR_ROWS });
          expect(door.row + door.rowSpan, label).toBe(layout.rows);
          // Ряды заполнены целиком (каждая клетка сетки занята ровно одним окном), перекрытий нет.
          const taken = new Map<string, number>();
          for (const cell of [...windows, door]) {
            expect(cell.col + cell.colSpan, label).toBeLessThanOrEqual(RACK_COLUMNS);
            for (let r = cell.row; r < cell.row + cell.rowSpan; r += 1) {
              for (let c = cell.col; c < cell.col + cell.colSpan; c += 0.5) {
                const key = `${r}:${c}`;
                expect(taken.has(key), `${label}: перекрытие ${key}`).toBe(false);
                taken.set(key, cell.n ?? 0);
              }
            }
          }
          for (let r = 0; r < door.row; r += 1) {
            expect(taken.has(`${r}:0`) && taken.has(`${r}:1`), `${label}: дыра в ряду ${r}`).toBe(true);
          }
          // Сегодняшнее окно на всю ширину в два ряда; финал в мансарде на всю ширину сверху.
          const big = windows.filter((cell) => cell.big);
          expect(big.map((cell) => cell.n), label).toEqual(today === null ? [] : [today]);
          for (const cell of big) expect(cell, label).toMatchObject({ col: 0, colSpan: 2, rowSpan: 2 });
          if (attic) expect(windows.find((cell) => cell.n === days), label).toMatchObject({ kind: "attic", col: 0, row: 0, colSpan: 2 });
        }
      }
    }
  });

  it("окна идут парами, нечётное последнее растягивается на ширину, сегодняшнее при нечётной позиции забирает место у предыдущего", () => {
    const eight = facadeLayout(8, null, rackNoAttic);
    expect(eight.cells.filter((cell) => cell.kind === "window").map((cell) => [cell.n, cell.col, cell.row])).toEqual([[1, 0, 0], [2, 1, 0], [3, 0, 1], [4, 1, 1], [5, 0, 2], [6, 1, 2], [7, 0, 3], [8, 1, 3]]);
    const odd = facadeLayout(7, null, rackNoAttic);
    expect(odd.cells.find((cell) => cell.n === 7)).toMatchObject({ col: 0, colSpan: 2 });
    const today = facadeLayout(7, 4, rackNoAttic);
    expect(today.cells.find((cell) => cell.n === 3)).toMatchObject({ col: 0, colSpan: 2 });
    expect(today.cells.find((cell) => cell.n === 4)).toMatchObject({ col: 0, row: 2, rowSpan: 2, big: true });
  });

  it("обычная сетка по умолчанию остаётся в 4 колонки", () => {
    expect(facadeLayout(12, 6, withAttic).columns).toBe(FACADE_COLUMNS);
  });
});
