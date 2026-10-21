/**
 * Ходьба хозяина по улице перед фасадом «Витрины»: чистая арифметика без DOM и таймеров.
 * Положение — доля ширины стены (0 — левый край, 1 — правый); по вертикали хозяин всегда на улице,
 * к окну верхнего ряда он идёт по горизонтали до его колонки и показывает вверх (лестниц и прыжков нет).
 * Координаты берутся из раскладки окон (`facadeLayout`), поэтому работают на любом фасаде и при любом числе дней.
 */
import { FACADE_COLUMNS, type FacadeCell, type FacadeLayout } from "./facade-layout";

/** Самый длинный путь по времени: даже через весь фасад хозяин приходит не позже этого. */
export const WALK_MAX_MS = 900;
/** Самый короткий осмысленный путь. */
export const WALK_MIN_MS = 160;
/** Короче этого расстояния (доля ширины) ходьбы нет: хозяин уже стоит под окном. */
export const WALK_EPSILON = 0.012;

export type WalkFacing = 1 | -1;

/** Точка на улице под ячейкой: середина её колонок. */
export function standX(cell: Pick<FacadeCell, "col" | "colSpan">): number {
  return (cell.col + cell.colSpan / 2) / FACADE_COLUMNS;
}

export type StandPoints = { door: number; byDay: ReadonlyMap<number, number> };

/** Точки под дверью и под каждым окном раскладки. */
export function standPoints(layout: FacadeLayout): StandPoints {
  const byDay = new Map<number, number>();
  let door = 0.5;
  for (const cell of layout.cells) {
    if (cell.kind === "door") door = standX(cell);
    else if (cell.n !== null) byDay.set(cell.n, standX(cell));
  }
  return { door, byDay };
}

/** Куда идти к окну дня: под ним; окна, которого нет в раскладке, — к двери. */
export function targetFor(points: StandPoints, n: number | null): number {
  return n === null ? points.door : (points.byDay.get(n) ?? points.door);
}

/**
 * Время пути по расстоянию (доля ширины). Скорость растёт с расстоянием: короткий шаг не тянется,
 * через весь фасад (≈ 0,9 ширины) выходит ровно `WALK_MAX_MS`, дальше предел не растёт.
 */
export function walkDuration(distance: number): number {
  const d = Math.abs(distance);
  if (d < WALK_EPSILON) return 0;
  return Math.min(WALK_MAX_MS, Math.round(WALK_MIN_MS + (WALK_MAX_MS - WALK_MIN_MS) * Math.min(1, d / 0.9)));
}

export type Walk = { from: number; to: number; startedAt: number; duration: number };

/** Начать путь из точки `at` в точку `to`. */
export function startWalk(at: number, to: number, now: number): Walk {
  return { from: at, to, startedAt: now, duration: walkDuration(to - at) };
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export type WalkFrame = { x: number; done: boolean; facing: WalkFacing };

/** Положение в момент `now` (мс); плавный разгон и торможение. */
export function walkFrame(walk: Walk, now: number): WalkFrame {
  const facing: WalkFacing = walk.to >= walk.from ? 1 : -1;
  if (walk.duration <= 0) return { x: walk.to, done: true, facing };
  const t = Math.min(1, Math.max(0, (now - walk.startedAt) / walk.duration));
  return { x: walk.from + (walk.to - walk.from) * ease(t), done: t >= 1, facing };
}

/** Перенаправление на ходу: новый путь начинается там, где хозяин сейчас; прежняя цель отбрасывается без очереди. */
export function redirectWalk(current: Walk | null, restAt: number, to: number, now: number): Walk {
  return startWalk(current ? walkFrame(current, now).x : restAt, to, now);
}

/** Куда смотреть после пути: как шёл; если не двигался — прежнее направление. */
export function facingAfter(walk: Walk, previous: WalkFacing): WalkFacing {
  return Math.abs(walk.to - walk.from) < WALK_EPSILON ? previous : walk.to > walk.from ? 1 : -1;
}

/**
 * Куда хозяин выходит при первом показе: под сегодняшнее окно; `null` — идти некуда
 * (до старта и после финала сегодняшнего окна нет, хозяин остаётся у двери).
 */
export function introTarget(points: StandPoints, today: number | null): number | null {
  return today !== null && points.byDay.has(today) ? points.byDay.get(today)! : null;
}
