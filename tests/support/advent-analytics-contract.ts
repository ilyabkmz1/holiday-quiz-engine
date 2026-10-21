import { beforeEach, describe, expect, it } from "vitest";

import type { AnalyticsQuery, AnalyticsRepository } from "@/server/repositories/advent-repository";

import { CAMPAIGN, OTHER_CAMPAIGN, grantRecord, participantRecord, type AdventBackend } from "./advent-repository-contract";

export type AnalyticsBackend = AdventBackend & AnalyticsRepository;

const iso = (value: string) => new Date(value);

/** Окна трёх дней по московскому времени (UTC+3, открытие в 00:00): день n заканчивается в 00:00 МСК дня n+1. */
export const QUERY: AnalyticsQuery = {
  campaignSlug: CAMPAIGN,
  timezone: "Europe/Moscow",
  today: "2026-12-22",
  now: iso("2026-12-23T00:00:00Z"),
  windows: [
    { day: 1, start: iso("2026-12-19T21:00:00Z"), end: iso("2026-12-20T21:00:00Z"), blocks: 2 },
    { day: 2, start: iso("2026-12-20T21:00:00Z"), end: iso("2026-12-21T21:00:00Z"), blocks: 2 },
    { day: 3, start: iso("2026-12-21T21:00:00Z"), end: iso("2026-12-22T21:00:00Z"), blocks: 1 }
  ],
  retentionOffsets: [1, 3, 7]
};

/**
 * Контракт метрик адвента: ожидания посчитаны вручную на небольшой кампании (см. комментарии к участникам). Запускается на
 * in-memory и на PostgreSQL: SQL-агрегаты и память обязаны давать одно и то же, включая границу суток в часовом поясе кампании.
 */
export function describeAnalyticsContract(name: string, create: () => Promise<AnalyticsBackend>): void {
  describe(`контракт метрик адвента: ${name}`, () => {
    let repo: AnalyticsBackend;
    beforeEach(async () => {
      repo = await create();
    });

    it("пустая кампания: нули и пустые списки, без ошибок", async () => {
      const raw = await repo.analyticsRaw(QUERY);
      expect(raw).toMatchObject({ participants: 0, players: 0, withEmail: 0, withConsent: 0, withMarketing: 0, withReminders: 0, activeToday: 0 });
      expect(raw.opens).toEqual([]);
      expect(raw.completed).toEqual([]);
      expect(raw.doorsHistogram).toEqual([]);
      expect(raw.onTimePatterns).toEqual([]);
      expect(raw.cohorts).toEqual([]);
      expect(raw.grants).toEqual([]);
      expect(raw.activeByDay).toEqual([1, 2, 3].map((day) => ({ day, active: 0, opened: 0, returning: 0, returningOnTime: 0 })));
      expect(await repo.teamStats(CAMPAIGN)).toEqual([]);
    });

    describe("кампания из четырёх участников", () => {
      // P1 — вошёл по email, команда t1. Первый визит 23:30 МСК 20.12. Дверь 1 открыта за секунду до полуночи МСК (ещё 20.12),
      //      дверь 2 — ровно в полночь МСК (уже 21.12): граница суток по часовому поясу кампании, а не UTC.
      // P2 — аноним, пришёл 21.12 в 12:00 МСК; день 2 вовремя, день 3 догнал 24.12.
      // P3 — только посмотрел (без дверей), команда t1.
      // P4 — аноним, команда t2; день 1 вовремя, день 2 догнал 22.12 в 03:00 МСК.
      beforeEach(async () => {
        const p1 = await repo.createParticipant(
          participantRecord({ createdAt: iso("2026-12-20T20:30:00Z"), normalizedEmail: "p1@example.test", consentAt: iso("2026-12-20T20:31:00Z"), marketingConsentAt: iso("2026-12-20T20:31:00Z"), reminderOptIn: true, teamId: "t1" })
        );
        const p2 = await repo.createParticipant(participantRecord({ createdAt: iso("2026-12-21T09:00:00Z") }));
        await repo.createParticipant(participantRecord({ createdAt: iso("2026-12-20T10:00:00Z"), teamId: "t1" }));
        const p4 = await repo.createParticipant(participantRecord({ createdAt: iso("2026-12-20T10:00:00Z"), teamId: "t2" }));
        for (const [participant, day, at, onTime] of [
          [p1, 1, "2026-12-20T20:59:59Z", true],
          [p1, 2, "2026-12-20T21:00:00Z", true],
          [p1, 3, "2026-12-22T09:00:00Z", true],
          [p2, 2, "2026-12-21T10:00:00Z", true],
          [p2, 3, "2026-12-24T10:00:00Z", false],
          [p4, 1, "2026-12-20T11:00:00Z", true],
          [p4, 2, "2026-12-22T00:00:00Z", false]
        ] as const) {
          await repo.openDayOnce(participant.id, day, iso(at), onTime);
        }
        for (const [participant, day, block, points] of [
          [p1, 1, 0, 0],
          [p1, 1, 1, 100],
          [p1, 2, 0, 0],
          [p1, 3, 0, 50],
          [p2, 2, 0, 0],
          [p2, 2, 1, 100]
        ] as const) {
          await repo.recordBlockResultOnce({ participantId: participant.id, day, blockIndex: block, result: { kind: "story" }, points, createdAt: iso("2026-12-22T00:00:00Z") });
        }
        await repo.grantOnce(grantRecord(p1.id, { day: 1, rewardId: "r-gift", code: "X1", status: "redeemed", redeemedAt: iso("2026-12-21T10:00:00Z"), expiresAt: iso("2027-01-05T00:00:00Z") }));
        await repo.grantOnce(grantRecord(p2.id, { day: 2, rewardId: "r-gift", code: "X2", expiresAt: iso("2026-12-22T00:00:00Z") }));
        await repo.grantOnce(grantRecord(p4.id, { day: 1, rewardId: "r-gift", code: null }));
        await repo.grantOnce(grantRecord(p1.id, { day: 2, source: "luck", rewardId: "r-luck", code: "X3", expiresAt: iso("2027-01-01T00:00:00Z") }));
        // Чужая кампания не должна просачиваться ни в один агрегат.
        const other = await repo.createParticipant(participantRecord({ campaignSlug: OTHER_CAMPAIGN, createdAt: iso("2026-12-20T10:00:00Z"), teamId: "t1", normalizedEmail: "o@example.test" }));
        await repo.openDayOnce(other.id, 1, iso("2026-12-20T11:00:00Z"), true);
        await repo.grantOnce(grantRecord(other.id, { day: 1, rewardId: "r-gift", code: "Z" }));
      });

      it("счётчики участников, регистрации и согласий", async () => {
        const raw = await repo.analyticsRaw(QUERY);
        expect(raw).toMatchObject({ participants: 4, players: 3, withEmail: 1, withConsent: 1, withMarketing: 1, withReminders: 1 });
      });

      it("открытия по дням: вовремя и догнали", async () => {
        const raw = await repo.analyticsRaw(QUERY);
        expect(raw.opens).toEqual([
          { day: 1, onTime: 2, caughtUp: 0 },
          { day: 2, onTime: 2, caughtUp: 1 },
          { day: 3, onTime: 1, caughtUp: 1 }
        ]);
      });

      it("день закрыт целиком, только если есть результаты всех блоков дня", async () => {
        const raw = await repo.analyticsRaw(QUERY);
        // День 1 (2 блока): P1. День 2 (2 блока): P2 (у P1 только один блок). День 3 (1 блок): P1.
        expect(raw.completed).toEqual([{ day: 1, count: 1 }, { day: 2, count: 1 }, { day: 3, count: 1 }]);
      });

      it("активные на конец окна и открывшие день: граница — первое открытие строго до конца окна", async () => {
        const raw = await repo.analyticsRaw(QUERY);
        expect(raw.activeByDay).toEqual([
          // P1 (20:59:59Z < 21:00:00Z) и P4 активны, P2 пришёл позже. В день 1 «игравших раньше» нет.
          { day: 1, active: 2, opened: 2, returning: 0, returningOnTime: 0 },
          // До начала дня 2 (21:00Z) играли P1 (на секунду раньше) и P4; вовремя день 2 открыла только P1 (P4 догнал).
          { day: 2, active: 3, opened: 3, returning: 2, returningOnTime: 1 },
          // До дня 3 играли все трое; вовремя — только P1 (P2 догнал 24.12, P4 день 3 не открывал).
          { day: 3, active: 3, opened: 2, returning: 3, returningOnTime: 1 }
        ]);
      });

      it("гистограмма дверей и рисунки открытых вовремя дней", async () => {
        const raw = await repo.analyticsRaw(QUERY);
        expect(raw.doorsHistogram).toEqual([{ doors: 2, count: 2 }, { doors: 3, count: 1 }]);
        const patterns = [...raw.onTimePatterns].sort((a, b) => a.days.join().localeCompare(b.days.join()));
        expect(patterns).toEqual([{ days: [1], count: 1 }, { days: [1, 2, 3], count: 1 }, { days: [2], count: 1 }]);
      });

      it("когорты по локальной дате первого визита и возврат (граница суток по МСК)", async () => {
        const raw = await repo.analyticsRaw(QUERY);
        expect(raw.cohorts).toEqual([
          // 20.12: P1 (23:30 МСК), P3, P4. P1 открыла дверь 2 в 00:00 МСК 21.12 → возврат на +1. Остальные +1/+3/+7 не открывали.
          { date: "2026-12-20", size: 3, returned: [{ offset: 1, count: 1 }] },
          // 21.12: P2; дверь 3 открыта 24.12 (+3).
          { date: "2026-12-21", size: 1, returned: [{ offset: 3, count: 1 }] }
        ]);
      });

      it("активные сегодня: открытие в локальную дату today, считаются один раз", async () => {
        // 22.12 по МСК: P1 (дверь 3 в 12:00) и P4 (дверь 2 в 03:00).
        expect((await repo.analyticsRaw(QUERY)).activeToday).toBe(2);
        // Сдвиг даты: 21.12 открывали P1 (дверь 2 в 00:00 МСК) и P2 (13:00 МСК).
        expect((await repo.analyticsRaw({ ...QUERY, today: "2026-12-21" })).activeToday).toBe(2);
        expect((await repo.analyticsRaw({ ...QUERY, today: "2026-12-25" })).activeToday).toBe(0);
      });

      it("выдачи: выдано, погашено, истекли к now, без кода", async () => {
        const raw = await repo.analyticsRaw(QUERY);
        expect(raw.grants).toEqual([
          { rewardId: "r-gift", source: "day", issued: 3, redeemed: 1, expired: 1, withoutCode: 1 },
          { rewardId: "r-luck", source: "luck", issued: 1, redeemed: 0, expired: 0, withoutCode: 0 }
        ]);
        // Раньше срока награда P2 ещё жива.
        const early = await repo.analyticsRaw({ ...QUERY, now: iso("2026-12-21T12:00:00Z") });
        expect(early.grants.find((row) => row.rewardId === "r-gift")?.expired).toBe(0);
      });

      it("команды: участники, игроки, двери и очки", async () => {
        expect(await repo.teamStats(CAMPAIGN)).toEqual([
          { teamId: "t1", members: 2, players: 1, doors: 3, points: 150 },
          { teamId: "t2", members: 1, players: 1, doors: 2, points: 0 }
        ]);
      });
    });

    it("setParticipantTeam меняет и снимает команду; неизвестный участник — null", async () => {
      const participant = await repo.createParticipant(participantRecord({ teamId: null }));
      expect((await repo.setParticipantTeam(participant.id, "t9"))?.teamId).toBe("t9");
      expect((await repo.getParticipant(participant.id))?.teamId).toBe("t9");
      expect((await repo.setParticipantTeam(participant.id, null))?.teamId).toBeNull();
      expect(await repo.setParticipantTeam("00000000-0000-4000-8000-000000000001", "t1")).toBeNull();
    });

    it("слияние переносит команду поглощённого, если у итогового её нет", async () => {
      const from = await repo.createParticipant(participantRecord({ teamId: "t3" }));
      const into = await repo.createParticipant(participantRecord({ teamId: null }));
      await repo.mergeParticipants(from.id, into.id);
      expect((await repo.getParticipant(into.id))?.teamId).toBe("t3");
      const keep = await repo.createParticipant(participantRecord({ teamId: "t1" }));
      const gone = await repo.createParticipant(participantRecord({ teamId: "t2" }));
      await repo.mergeParticipants(gone.id, keep.id);
      expect((await repo.getParticipant(keep.id))?.teamId).toBe("t1");
    });
  });
}
