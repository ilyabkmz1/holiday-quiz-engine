import { describe, expect, it } from "vitest";

import { endOfLocalDay, fillPlaceholders, localDateAt, localInstant, reminderSendAt, reminderWindowAt, unknownPlaceholders, type AdventSchedule } from "@/domain/advent";

const schedule = (patch: Partial<AdventSchedule> = {}): AdventSchedule => ({
  timezone: "Europe/Moscow",
  startDate: "2026-12-20",
  days: 12,
  unlockHour: 0,
  finaleAt: "2027-01-01T00:00:00+03:00",
  claimEndsAt: "2027-01-14T23:59:59+03:00",
  catchUp: "none",
  rewardOnlyOnDay: false,
  ...patch
});

describe("локальное время", () => {
  it("localDateAt: календарная дата по часовому поясу, а не по UTC", () => {
    expect(localDateAt(new Date("2026-12-20T21:30:00Z"), "Europe/Moscow")).toBe("2026-12-21");
    expect(localDateAt(new Date("2026-12-20T21:30:00Z"), "UTC")).toBe("2026-12-20");
    expect(localDateAt(new Date("2026-12-20T15:00:00Z"), "Asia/Vladivostok")).toBe("2026-12-21");
    expect(localDateAt(new Date("2026-12-21T01:00:00Z"), "America/Los_Angeles")).toBe("2026-12-20");
  });

  it("localInstant: момент, когда часы показывают время", () => {
    expect(localInstant("2026-12-20", "08:30", "Europe/Moscow").toISOString()).toBe("2026-12-20T05:30:00.000Z");
    expect(localInstant("2026-12-20", "08:30", "Asia/Yekaterinburg").toISOString()).toBe("2026-12-20T03:30:00.000Z");
    expect(localInstant("2026-12-20", "00:00", "UTC").toISOString()).toBe("2026-12-20T00:00:00.000Z");
  });

  it("endOfLocalDay: ближайшая местная полночь, в том числе при переводе часов", () => {
    expect(endOfLocalDay(new Date("2026-12-20T10:00:00Z"), "Europe/Moscow").toISOString()).toBe("2026-12-20T21:00:00.000Z");
    expect(endOfLocalDay(new Date("2026-12-20T21:00:00Z"), "Europe/Moscow").toISOString()).toBe("2026-12-21T21:00:00.000Z");
    // Берлин: 2026-03-29 — сутки на час короче (перевод вперёд ночью).
    expect(endOfLocalDay(new Date("2026-03-29T09:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(endOfLocalDay(new Date("2026-03-28T09:00:00Z"), "Europe/Berlin").toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });
});

describe("reminderSendAt и reminderWindowAt", () => {
  it("время рассылки — sendAtLocal даты дня, но не раньше открытия двери", () => {
    expect(reminderSendAt(3, schedule(), "10:00").toISOString()).toBe("2026-12-22T07:00:00.000Z");
    expect(reminderSendAt(3, schedule({ unlockHour: 12 }), "10:00").toISOString()).toBe("2026-12-22T09:00:00.000Z");
  });

  it("окно: до времени — early, внутри — open, после maxLate — late; до старта — null", () => {
    const lateMs = 3 * 3_600_000;
    const at = (iso: string) => reminderWindowAt(new Date(iso), schedule(), "10:00", lateMs);
    expect(at("2026-12-19T12:00:00+03:00")).toBeNull();
    expect(at("2026-12-21T09:59:00+03:00")).toEqual({ day: 2, state: "early" });
    expect(at("2026-12-21T10:00:00+03:00")).toEqual({ day: 2, state: "open" });
    expect(at("2026-12-21T12:59:00+03:00")).toEqual({ day: 2, state: "open" });
    expect(at("2026-12-21T13:00:00+03:00")).toEqual({ day: 2, state: "late" });
  });

  it("часовой пояс кампании: один и тот же момент UTC — разные дни и окна", () => {
    const now = new Date("2026-12-20T20:00:00Z");
    expect(reminderWindowAt(now, schedule(), "10:00", 3_600_000 * 20)).toEqual({ day: 1, state: "open" });
    expect(reminderWindowAt(now, schedule({ timezone: "Asia/Vladivostok" }), "10:00", 3_600_000 * 20)).toEqual({ day: 2, state: "early" });
  });
});

describe("подстановки", () => {
  it("fillPlaceholders: известные подставляются, неизвестные остаются", () => {
    expect(fillPlaceholders("Дверь {day}: {teaser} {other}", { day: 3, teaser: "Кофе" })).toBe("Дверь 3: Кофе {other}");
    expect(fillPlaceholders("без подстановок", { day: 1 })).toBe("без подстановок");
  });

  it("значение с фигурными скобками повторно не разворачивается", () => {
    expect(fillPlaceholders("{teaser}", { teaser: "{day}", day: 5 })).toBe("{day}");
  });

  it("unknownPlaceholders находит опечатки", () => {
    expect(unknownPlaceholders("Окно {day}: {teaser}")).toEqual([]);
    expect(unknownPlaceholders("Окно {dya}, {title}, {dya}")).toEqual(["dya", "title"]);
    expect(unknownPlaceholders("{missed}", ["day", "missed"])).toEqual([]);
  });
});
