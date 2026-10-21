import { describe, expect, it } from "vitest";

import {
  FACADE_COLUMNS,
  WALK_MAX_MS,
  facadeLayout,
  facingAfter,
  introTarget,
  redirectWalk,
  standPoints,
  standX,
  startWalk,
  targetFor,
  walkDuration,
  walkFrame
} from "@/domain/advent";

const withAttic = { layout: { attic: true } };
const noAttic = { layout: { attic: false } };

describe("ходьба хозяина: точки под окнами", () => {
  it("точка — середина колонок ячейки, дверь и мансарда по центру", () => {
    expect(standX({ col: 0, colSpan: 1 })).toBeCloseTo(0.125);
    expect(standX({ col: 3, colSpan: 1 })).toBeCloseTo(0.875);
    expect(standX({ col: 1, colSpan: 2 })).toBeCloseTo(0.5);
    const points = standPoints(facadeLayout(12, 4, withAttic));
    expect(points.door).toBeCloseTo(0.5);
    expect(points.byDay.get(12)).toBeCloseTo(0.5);
  });

  it("у каждого дня при любом числе дней и сегодняшнем окне есть точка внутри стены", () => {
    for (const template of [withAttic, noAttic]) {
      for (let days = 5; days <= 31; days += 1) {
        for (const today of [null, 1, Math.ceil(days / 2), days]) {
          const points = standPoints(facadeLayout(days, today, template));
          expect(points.byDay.size).toBe(days);
          for (const x of points.byDay.values()) {
            expect(x).toBeGreaterThan(0);
            expect(x).toBeLessThan(1);
          }
        }
      }
    }
  });

  it("окна, которого нет, ведут к двери; цель выхода — сегодняшнее окно", () => {
    const points = standPoints(facadeLayout(12, 4, withAttic));
    expect(targetFor(points, 99)).toBe(points.door);
    expect(targetFor(points, null)).toBe(points.door);
    expect(targetFor(points, 4)).toBe(points.byDay.get(4));
    expect(introTarget(points, 4)).toBe(points.byDay.get(4));
    expect(introTarget(points, null)).toBeNull();
    expect(introTarget(points, 99)).toBeNull();
  });
});

describe("ходьба хозяина: время пути", () => {
  it("через весь фасад не дольше предела, короткий путь короче, на месте — ноль", () => {
    expect(walkDuration(0)).toBe(0);
    expect(walkDuration(0.005)).toBe(0);
    expect(walkDuration(0.9)).toBe(WALK_MAX_MS);
    expect(walkDuration(-5)).toBe(WALK_MAX_MS);
    expect(walkDuration(1 / FACADE_COLUMNS)).toBeLessThan(walkDuration(0.5));
    expect(walkDuration(0.25)).toBeGreaterThan(0);
  });

  it("время растёт с расстоянием, а скорость тоже: дальний путь быстрее в пересчёте на ширину", () => {
    const short = 0.25 / walkDuration(0.25);
    const long = 0.75 / walkDuration(0.75);
    expect(walkDuration(0.25)).toBeLessThan(walkDuration(0.75));
    expect(long).toBeGreaterThan(short);
  });
});

describe("ходьба хозяина: кадры и перенаправление", () => {
  it("начало, середина и конец пути; взгляд по направлению", () => {
    const walk = startWalk(0.5, 0.125, 1000);
    expect(walkFrame(walk, 1000)).toMatchObject({ x: 0.5, done: false, facing: -1 });
    const middle = walkFrame(walk, 1000 + walk.duration / 2);
    expect(middle.x).toBeCloseTo((0.5 + 0.125) / 2, 3);
    expect(middle.done).toBe(false);
    expect(walkFrame(walk, 1000 + walk.duration)).toMatchObject({ x: 0.125, done: true });
    expect(walkFrame(walk, 99999).x).toBe(0.125);
    expect(walkFrame(startWalk(0.2, 0.8, 0), 0).facing).toBe(1);
  });

  it("путь нулевой длины приходит сразу", () => {
    const walk = startWalk(0.5, 0.5, 10);
    expect(walk.duration).toBe(0);
    expect(walkFrame(walk, 10).done).toBe(true);
  });

  it("положение не прыгает и не выходит за концы пути", () => {
    const walk = startWalk(0.875, 0.125, 0);
    let previous = walk.from;
    for (let t = 0; t <= walk.duration; t += 8) {
      const { x } = walkFrame(walk, t);
      expect(x).toBeLessThanOrEqual(previous + 1e-9);
      expect(x).toBeGreaterThanOrEqual(0.125 - 1e-9);
      previous = x;
    }
  });

  it("перенаправление на ходу стартует оттуда, где хозяин сейчас, и с полной длительностью до новой цели", () => {
    const first = startWalk(0.5, 0.875, 0);
    const now = first.duration / 2;
    const here = walkFrame(first, now).x;
    const second = redirectWalk(first, 0.5, 0.125, now);
    expect(second.from).toBeCloseTo(here);
    expect(second.to).toBe(0.125);
    expect(second.startedAt).toBe(now);
    expect(second.duration).toBe(walkDuration(0.125 - here));
    expect(walkFrame(second, now).facing).toBe(-1);
    // Без идущего пути берётся место покоя.
    expect(redirectWalk(null, 0.5, 0.875, 5).from).toBe(0.5);
  });

  it("после пути взгляд остаётся прежним, если хозяин не двигался", () => {
    expect(facingAfter(startWalk(0.5, 0.125, 0), 1)).toBe(-1);
    expect(facingAfter(startWalk(0.5, 0.875, 0), -1)).toBe(1);
    expect(facingAfter(startWalk(0.5, 0.5, 0), -1)).toBe(-1);
  });
});
