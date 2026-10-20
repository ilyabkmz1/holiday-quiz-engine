/**
 * Раскладка окон фасада «Витрины»: чистая функция от числа дней, сегодняшнего дня и шаблона.
 * Сетка в 4 колонки; координаты в колонках (шаг 0,5: так центрируется неполный ряд), ряды целые.
 *
 * Сверху вниз:
 * - финальное окно N — «мансарда» шириной 2 колонки по центру (если шаблон её допускает);
 * - окна 1…N−1 слева направо по рядам; сегодняшнее занимает 2×2 ячейки;
 * - внизу дверь шириной 2 колонки по центру; одно-два последних окна неполного ряда стоят по бокам двери.
 */
export const FACADE_COLUMNS = 4;

export type FacadeCellKind = "window" | "attic" | "door";

export type FacadeCell = {
  kind: FacadeCellKind;
  /** Номер дня; у двери его нет. */
  n: number | null;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  /** Сегодняшнее окно: 2×2 ячейки (у мансарды — 2 колонки на 2 ряда). */
  big: boolean;
};

export type FacadeLayout = { columns: typeof FACADE_COLUMNS; rows: number; cells: FacadeCell[] };

/** Часть шаблона, от которой зависит раскладка. */
export type FacadeLayoutTemplate = { layout: { attic: boolean } };

type Placed = FacadeCell & { kind: "window" | "attic" };

export function facadeLayout(days: number, today: number | null, template: FacadeLayoutTemplate): FacadeLayout {
  if (!Number.isInteger(days) || days < 1) throw new Error(`Число дней фасада: целое от 1, получено ${days}`);
  const big = today !== null && today >= 1 && today <= days ? today : null;
  const withAttic = template.layout.attic && days >= 3;
  const cells: Placed[] = [];
  let startRow = 0;

  if (withAttic) {
    const atticBig = big === days;
    cells.push({ kind: "attic", n: days, col: 1, row: 0, colSpan: 2, rowSpan: atticBig ? 2 : 1, big: atticBig });
    startRow = atticBig ? 2 : 1;
  }
  const lastMain = withAttic ? days - 1 : days;

  const taken = new Set<string>();
  const key = (row: number, col: number) => `${row}:${col}`;
  let row = startRow;
  let col = 0;
  const skipTaken = () => {
    while (taken.has(key(row, col))) {
      col += 1;
      if (col >= FACADE_COLUMNS) {
        row += 1;
        col = 0;
      }
    }
  };

  for (let n = 1; n <= lastMain; n += 1) {
    skipTaken();
    if (n === big) {
      // Сегодняшнему окну нужны две колонки подряд; в последней колонке места нет, ячейка остаётся пустой стеной.
      if (col > FACADE_COLUMNS - 2) {
        row += 1;
        col = 0;
        skipTaken();
      }
      for (const dr of [0, 1]) for (const dc of [0, 1]) taken.add(key(row + dr, col + dc));
      cells.push({ kind: "window", n, col, row, colSpan: 2, rowSpan: 2, big: true });
      col += 2;
    } else {
      taken.add(key(row, col));
      cells.push({ kind: "window", n, col, row, colSpan: 1, rowSpan: 1, big: false });
      col += 1;
    }
    if (col >= FACADE_COLUMNS) {
      row += 1;
      col = 0;
    }
  }

  // Последний ряд без сегодняшнего окна: одно-два окна уходят к двери, три центрируются.
  const mainCells = cells.filter((cell) => cell.kind === "window");
  const lastRow = mainCells.reduce((max, cell) => Math.max(max, cell.row + cell.rowSpan - 1), startRow - 1);
  const tail = mainCells.filter((cell) => cell.row + cell.rowSpan - 1 === lastRow);
  const tailHasBig = tail.some((cell) => cell.big);
  const flank = !tailHasBig && tail.length > 0 && tail.length <= 2 ? tail : [];
  if (!tailHasBig && tail.length === 3) for (const cell of tail) cell.col += 0.5;

  const mainBottom = mainCells.reduce((max, cell) => (flank.includes(cell) ? max : Math.max(max, cell.row + cell.rowSpan)), startRow);
  const doorRow = Math.max(mainBottom, startRow);
  flank.forEach((cell, index) => {
    cell.row = doorRow;
    cell.col = index === 0 ? 0 : FACADE_COLUMNS - 1;
  });

  const out: FacadeCell[] = [...cells, { kind: "door", n: null, col: 1, row: doorRow, colSpan: 2, rowSpan: 1, big: false }];
  return { columns: FACADE_COLUMNS, rows: doorRow + 1, cells: out };
}
