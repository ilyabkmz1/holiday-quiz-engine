import { describe, expect, it } from "vitest";

import { adventPhase, dayIndexAt, dayLocalDate, dayUnlockAt, type AdventSchedule } from "@/domain/advent/calendar";

const moscow: AdventSchedule = {
  timezone: "Europe/Moscow",
  startDate: "2026-12-20",
  days: 12,
  unlockHour: 0,
  finaleAt: "2027-01-01T00:00:00+03:00",
  claimEndsAt: "2027-01-14T23:59:59+03:00",
  catchUp: "none",
  rewardOnlyOnDay: false
};

const iso = (date: Date) => date.toISOString();

describe("dayUnlockAt", () => {
  it("Москва: день открывается в unlockHour по местному времени (UTC+3)", () => {
    expect(iso(dayUnlockAt(1, moscow))).toBe("2026-12-19T21:00:00.000Z");
    expect(iso(dayUnlockAt(12, moscow))).toBe("2026-12-30T21:00:00.000Z");
    expect(iso(dayUnlockAt(1, { ...moscow, unlockHour: 9 }))).toBe("2026-12-20T06:00:00.000Z");
  });

  it("Екатеринбург (UTC+5)", () => {
    const schedule = { ...moscow, timezone: "Asia/Yekaterinburg", unlockHour: 8 };
    expect(iso(dayUnlockAt(1, schedule))).toBe("2026-12-20T03:00:00.000Z");
    expect(iso(dayUnlockAt(3, schedule))).toBe("2026-12-22T03:00:00.000Z");
  });

  it("Берлин зимой (UTC+1) и летом (UTC+2)", () => {
    expect(iso(dayUnlockAt(1, { ...moscow, timezone: "Europe/Berlin" }))).toBe("2026-12-19T23:00:00.000Z");
    expect(iso(dayUnlockAt(1, { ...moscow, timezone: "Europe/Berlin", startDate: "2026-07-01" }))).toBe("2026-06-30T22:00:00.000Z");
  });

  it("Берлин: переход на летнее время 29.03.2026 в 01:00 UTC", () => {
    const berlin = { ...moscow, timezone: "Europe/Berlin", startDate: "2026-03-28", unlockHour: 0 };
    expect(iso(dayUnlockAt(1, berlin))).toBe("2026-03-27T23:00:00.000Z"); // 28.03 00:00 CET
    expect(iso(dayUnlockAt(2, berlin))).toBe("2026-03-28T23:00:00.000Z"); // 29.03 00:00 CET
    expect(iso(dayUnlockAt(3, berlin))).toBe("2026-03-29T22:00:00.000Z"); // 30.03 00:00 CEST: между днями 23 часа
    // Час после перехода: 04:00 CEST = 02:00 UTC.
    expect(iso(dayUnlockAt(2, { ...berlin, unlockHour: 4 }))).toBe("2026-03-29T02:00:00.000Z");
  });

  it("Берлин: несуществующий час 02:00 в день перехода сдвигается на 03:00 CEST", () => {
    const berlin = { ...moscow, timezone: "Europe/Berlin", startDate: "2026-03-29", unlockHour: 2 };
    expect(iso(dayUnlockAt(1, berlin))).toBe("2026-03-29T01:00:00.000Z");
  });

  it("Берлин: повторяющийся час 02:00 при переходе на зимнее время (25.10.2026) берёт первое вхождение", () => {
    const berlin = { ...moscow, timezone: "Europe/Berlin", startDate: "2026-10-25", unlockHour: 2 };
    expect(iso(dayUnlockAt(1, berlin))).toBe("2026-10-25T00:00:00.000Z");
  });

  it("Сан-Паулу (2018): полночь в день перехода не существует — день открывается в 01:00 по новому времени", () => {
    const saoPaulo = { ...moscow, timezone: "America/Sao_Paulo", startDate: "2018-11-03", unlockHour: 0 };
    expect(iso(dayUnlockAt(1, saoPaulo))).toBe("2018-11-03T03:00:00.000Z"); // 00:00 UTC−3
    expect(iso(dayUnlockAt(2, saoPaulo))).toBe("2018-11-04T03:00:00.000Z"); // 01:00 UTC−2
    expect(iso(dayUnlockAt(3, saoPaulo))).toBe("2018-11-05T02:00:00.000Z"); // 00:00 UTC−2
    expect(dayIndexAt(new Date("2018-11-04T02:59:59Z"), { ...saoPaulo, days: 5 })).toBe(1);
  });

  it("Лорд-Хау: перевод часов на 30 минут", () => {
    const lordHowe = { ...moscow, timezone: "Australia/Lord_Howe", startDate: "2026-10-04", unlockHour: 2 };
    expect(iso(dayUnlockAt(1, lordHowe))).toBe("2026-10-03T15:30:00.000Z"); // 02:00 не существует → 02:30 UTC+11
    expect(iso(dayUnlockAt(2, lordHowe))).toBe("2026-10-04T15:00:00.000Z");
  });

  it("n выходит за границы месяца и года", () => {
    expect(iso(dayUnlockAt(13, moscow))).toBe("2026-12-31T21:00:00.000Z");
    expect(iso(dayUnlockAt(14, moscow))).toBe("2027-01-01T21:00:00.000Z");
  });

  it("плохая дата начала — ошибка", () => {
    expect(() => dayUnlockAt(1, { ...moscow, startDate: "20.12.2026" })).toThrow(/YYYY-MM-DD/);
  });
});

describe("dayLocalDate", () => {
  it("startDate + n − 1 суток", () => {
    expect(dayLocalDate(1, moscow)).toBe("2026-12-20");
    expect(dayLocalDate(12, moscow)).toBe("2026-12-31");
    expect(dayLocalDate(13, moscow)).toBe("2027-01-01");
  });
});

describe("dayIndexAt", () => {
  const unlock1 = dayUnlockAt(1, moscow).getTime();
  const unlock2 = dayUnlockAt(2, moscow).getTime();

  it("null до открытия первого дня; на границе и на 1 мс позже — день 1", () => {
    expect(dayIndexAt(new Date(unlock1 - 1), moscow)).toBeNull();
    expect(dayIndexAt(new Date(unlock1), moscow)).toBe(1);
    expect(dayIndexAt(new Date(unlock1 + 1), moscow)).toBe(1);
  });

  it("смена дня ровно в unlockHour", () => {
    expect(dayIndexAt(new Date(unlock2 - 1), moscow)).toBe(1);
    expect(dayIndexAt(new Date(unlock2), moscow)).toBe(2);
  });

  it("с unlockHour = 9 день сменяется в 09:00, а не в полночь", () => {
    const nine = { ...moscow, unlockHour: 9 };
    expect(dayIndexAt(new Date("2026-12-21T08:59:59+03:00"), nine)).toBe(1);
    expect(dayIndexAt(new Date("2026-12-21T09:00:00+03:00"), nine)).toBe(2);
    expect(dayIndexAt(new Date("2026-12-20T08:59:59+03:00"), nine)).toBeNull();
  });

  it("после последнего дня остаётся schedule.days", () => {
    expect(dayIndexAt(new Date("2027-02-01T00:00:00Z"), moscow)).toBe(12);
  });

  it("зависит от часового пояса: один момент — разные дни", () => {
    const instant = new Date("2026-12-20T20:00:00Z"); // Москва 23:00 20.12, Екатеринбург 01:00 21.12
    expect(dayIndexAt(instant, moscow)).toBe(1);
    expect(dayIndexAt(instant, { ...moscow, timezone: "Asia/Yekaterinburg" })).toBe(2);
  });
});

describe("adventPhase", () => {
  const at = (value: string) => adventPhase(new Date(value), moscow);

  it("upcoming → running → finale → closed на границах", () => {
    expect(at("2026-12-19T20:59:59.999Z")).toBe("upcoming");
    expect(at("2026-12-19T21:00:00.000Z")).toBe("running");
    expect(at("2026-12-31T20:59:59.999Z")).toBe("running");
    expect(at("2026-12-31T21:00:00.000Z")).toBe("finale"); // finaleAt = 01.01 00:00 MSK
    expect(at("2027-01-14T20:59:58.999Z")).toBe("finale");
    expect(at("2027-01-14T20:59:59.000Z")).toBe("closed");
  });

  it("если claimEndsAt = finaleAt, финальной фазы нет", () => {
    const schedule = { ...moscow, claimEndsAt: moscow.finaleAt };
    expect(adventPhase(new Date("2026-12-31T20:59:59.999Z"), schedule)).toBe("running");
    expect(adventPhase(new Date("2026-12-31T21:00:00.000Z"), schedule)).toBe("closed");
  });
});
