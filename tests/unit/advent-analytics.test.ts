import { beforeEach, describe, expect, it } from "vitest";

import { dayLocalDate } from "@/domain/advent";
import { clearLeaderboardCache, loadAdventAnalytics, loadTeamLeaderboard, LEADERBOARD_TTL_MS } from "@/server/advent-metrics";
import { daysMetricsToCsv, rewardsMetricsToCsv, cohortsMetricsToCsv } from "@/server/csv";

import { adventConfig, at, newAdventService, playDay, verifyParticipant } from "../support/advent";

beforeEach(() => clearLeaderboardCache());

describe("loadAdventAnalytics: ручной сценарий на фикстуре (12 дней, МСК, догоняние на 1 день)", () => {
  // Сейчас — 23.12 12:00 МСК (день 4 идёт).
  // A — вошла по email 20.12, открыла дни 1–4 вовремя, дни 1–3 прошла целиком; день 4 только открыла.
  // B — аноним, пришёл 21.12: догнал день 1 (онтайм нет), день 2 открыл вовремя, но прошёл только историю; день 3 пропустил.
  // C — зашёл 20.12 и ничего не открыл.
  async function scenario() {
    const ctx = newAdventService();
    const a = (await ctx.service.createParticipant(at(1, 10))).participant;
    await verifyParticipant(ctx, a.id, at(1, 10));
    const c = (await ctx.service.createParticipant(at(1, 9))).participant;
    const b = (await ctx.service.createParticipant(at(2, 9))).participant;
    for (const day of [1, 2, 3]) {
      await ctx.service.openDay(a.id, day, at(day, 11));
      await playDay(ctx.service, ctx.advent, a.id, day, at(day, 11));
    }
    await ctx.service.openDay(a.id, 4, at(4, 11));
    await ctx.service.openDay(b.id, 1, at(2, 10));
    await ctx.service.openDay(b.id, 2, at(2, 10));
    await ctx.service.submitBlock(b.id, 2, 0, {}, at(2, 10));
    // Первую выданную награду A гасит на кассе в тот же день, пока срок не вышел.
    const first = (await ctx.repository.listGrants(a.id)).find((grant) => grant.source === "day" && grant.day === 1)!;
    expect((await ctx.repository.redeemGrant(ctx.advent.slug, first.id, at(1, 13))).status).toBe("redeemed");
    const data = await loadAdventAnalytics(ctx.repository, ctx.advent, at(4, 12), await ctx.rewards.overview());
    return { ctx, data, ids: { a: a.id, b: b.id, c: c.id } };
  }

  it("итоговые числа, воронка регистрации и фаза", async () => {
    const { data } = await scenario();
    expect(data.phase).toBe("running");
    expect(data.today).toBe(4);
    expect(data.kpis).toMatchObject({ participants: 3, players: 2, activeToday: 1, redeemed: 1, doorsAvg: 3 });
    expect(data.registration.map((step) => [step.key, step.count])).toEqual([["participants", 3], ["player", 2], ["email", 1], ["marketing", 0], ["reminders", 0]]);
    expect(data.registration[2].share).toBeCloseTo(1 / 3);
  });

  it("кривая по дням: вовремя, догнали, пропустили из активных, закрыли целиком", async () => {
    const { data } = await scenario();
    const row = (day: number) => data.days.find((candidate) => candidate.day === day)!;
    // День 1 (3 блока): A вовремя, B догнал. Активна к концу дня только A (B впервые открыл дверь 21.12).
    expect(row(1)).toMatchObject({ status: "closed", onTime: 1, caughtUp: 1, opened: 2, active: 1, missed: 0, completed: 1, date: "2026-12-20" });
    // День 2: A и B вовремя; активны оба; целиком прошла только A.
    expect(row(2)).toMatchObject({ onTime: 2, caughtUp: 0, active: 2, missed: 0, completed: 1 });
    expect(row(2).onTimeShare).toBe(1);
    // День 3: открыла только A; B — пропустил из двух активных.
    expect(row(3)).toMatchObject({ onTime: 1, active: 2, missed: 1, completed: 1 });
    expect(row(3).onTimeShare).toBe(0.5);
    // «Играли раньше»: в день 1 таких нет; к дню 2 — только A; к дню 3 — A и B, вовремя день 3 открыла A.
    expect(row(1)).toMatchObject({ returning: 0, returningOnTime: 0, returningShare: null });
    expect(row(2)).toMatchObject({ returning: 1, returningOnTime: 1, returningShare: 1 });
    expect(row(3)).toMatchObject({ returning: 2, returningOnTime: 1, returningShare: 0.5 });
    // День 4 идёт сейчас: пропуск предварительный. Будущие окна без цифр.
    expect(row(4)).toMatchObject({ status: "running", onTime: 1, active: 2, missed: 1 });
    expect(row(5)).toMatchObject({ status: "future", active: 0, missed: null, onTimeShare: null });
  });

  it("двери на участника и лучшая серия с заморозкой", async () => {
    const { data } = await scenario();
    // A открыла 4, B — 2: среднее 3, медиана 3, один участник без дверей.
    expect(data.doors).toMatchObject({ avg: 3, median: 3, zero: 1, buckets: [{ value: 2, count: 1 }, { value: 4, count: 1 }] });
    // A: серия 4. B: день 1 догнан (не в серии), день 2 вовремя, день 3 прощён заморозкой → лучшая серия 1.
    expect(data.streaks.buckets).toEqual([{ value: 1, count: 1 }, { value: 4, count: 1 }]);
    expect(data.streaks.avg).toBe(2.5);
  });

  it("цели: подаренный день входит в прогресс", async () => {
    const { data } = await scenario();
    // Цель «4 двери»: прогресс A = 4 + 1 (подарок) = 5 → достигнута; B = 2 + 1 = 3 → нет. Цель «8» — никто.
    expect(data.goals.map((goal) => [goal.opened, goal.reached, goal.share])).toEqual([[4, 1, 0.5], [8, 0, 0]]);
  });

  it("возврат считается по созревшим когортам; D7 ещё нет", async () => {
    const { data } = await scenario();
    // Когорты: 20.12 — A, C (A вернулась 21.12 → +1 из 2); 21.12 — B (22.12 не открывал → 0). Основание D1 = 3, вернулась 1.
    expect(data.kpis.d1).toEqual({ count: 1, base: 3, share: 1 / 3 });
    expect(data.kpis.d7).toEqual({ count: 0, base: 0, share: null });
    // Когорты меньше 5 человек скрыты.
    expect(data.cohorts.rows.every((row) => row.hidden && row.size === null && row.cells.every((cell) => cell.count === null))).toBe(true);
  });

  it("награды: выдано, погашено, истекли; по типам и по способам", async () => {
    const { data } = await scenario();
    const gift = data.rewards.find((reward) => reward.rewardId === "daily-gift")!;
    // Выдано A за дни 1–3. День 1 погашен; день 2 (срок 2 суток с 24.12... выдан 21.12 11:00) к 23.12 12:00 истёк; день 3 жив.
    expect(gift).toMatchObject({ issued: 3, redeemed: 1, expired: 1, redeemable: true });
    expect(gift.redeemShare).toBeCloseTo(1 / 3);
    const goal = data.rewards.find((reward) => reward.rewardId === "goal-gift")!;
    expect(goal).toMatchObject({ issued: 1, redeemed: 0, expired: 0 });
    // Участие в финале не гасится: доли погашения нет.
    expect(data.rewards.find((reward) => reward.rewardId === "final-entry")).toMatchObject({ redeemable: false, redeemShare: null });
    expect(data.rewardsBySource.find((group) => group.key === "day")).toMatchObject({ issued: 3, redeemed: 1, expired: 1 });
    expect(data.rewardsBySource.find((group) => group.key === "endowed")?.issued).toBe(3);
    // B получила бонус возвращения: её первая открытая дверь (день 1) была догнана, серия «прервана» к моменту открытия дня 2.
    expect(data.rewardsBySource.find((group) => group.key === "comeback")?.issued).toBe(1);
    // Подарки: дневные 3 + цель 1 + возвращение 1; погашена одна.
    expect(data.rewardsByKind.find((group) => group.key === "gift")).toMatchObject({ issued: 5, redeemed: 1 });
  });

  it("при малой выборке выводы молчат, команд нет, напоминания включены без доставок", async () => {
    const { data } = await scenario();
    expect(data.insights.map((insight) => insight.key)).toEqual(["few-data"]);
    expect(data.teams).toBeNull();
    expect(data.reminders).toMatchObject({ channel: "email", sent: 0, clicked: 0, openedAfter: 0 });
  });

  it("лучшие и слабые дни не пересекаются и берутся только из закрытых с достаточной базой", async () => {
    const { data } = await scenario();
    // Активных меньше порога малых групп — ни лучших, ни слабых.
    expect(data.bestDays).toEqual([]);
    expect(data.weakDays).toEqual([]);
  });
});

describe("loadAdventAnalytics: пустая кампания и границы", () => {
  it("день 1 не становится «лучшим» автоматически: дни сравниваются по тем, кто играл и раньше", async () => {
    const ctx = newAdventService();
    // Шесть игроков пришли в день 1 и открыли его; день 2 вовремя открыли пятеро, день 3 — трое; ещё шесть новичков пришли
    // в день 3 и открыли только его. Доля среди активных у дня 1 — всегда 100%, у дня 3 её завышают новички.
    const veterans = [];
    for (let index = 0; index < 6; index += 1) {
      const participant = (await ctx.service.createParticipant(at(1, 9))).participant;
      await ctx.service.openDay(participant.id, 1, at(1, 10));
      veterans.push(participant.id);
    }
    for (const id of veterans.slice(0, 5)) await ctx.service.openDay(id, 2, at(2, 10));
    for (const id of veterans.slice(0, 3)) await ctx.service.openDay(id, 3, at(3, 10));
    for (let index = 0; index < 6; index += 1) {
      const participant = (await ctx.service.createParticipant(at(3, 9))).participant;
      await ctx.service.openDay(participant.id, 3, at(3, 10));
    }
    const data = await loadAdventAnalytics(ctx.repository, ctx.advent, at(5, 12), await ctx.rewards.overview());
    const row = (day: number) => data.days.find((candidate) => candidate.day === day)!;
    expect(row(1).onTimeShare).toBe(1);
    expect(row(1).returningShare).toBeNull();
    expect(row(3)).toMatchObject({ onTime: 9, active: 12, returning: 6, returningOnTime: 3, returningShare: 0.5 });
    // День 4 (закрыт, никто не открыл) — третий по счёту; в «лучшие» попадают максимум три дня.
    expect(data.bestDays.map((day) => day.day)).toEqual([2, 3, 4]);
    expect(data.bestDays.some((day) => day.day === 1)).toBe(false);
    const best = data.insights.find((insight) => insight.key === "best-day");
    expect(best?.text).toContain("2-й");
    expect(best?.text).toContain("83%");
  });

  it("после финала когорта последнего дня не тянет D1 вниз: вернуться ей было некуда", async () => {
    const ctx = newAdventService();
    // Шесть человек пришли 31.12 (день 12) и открыли его; 01.01 — уже финал, двери не открываются.
    for (let index = 0; index < 6; index += 1) {
      const participant = (await ctx.service.createParticipant(at(12, 10))).participant;
      await ctx.service.openDay(participant.id, 12, at(12, 11));
    }
    const data = await loadAdventAnalytics(ctx.repository, ctx.advent, new Date("2027-01-03T12:00:00+03:00"), await ctx.rewards.overview());
    expect(data.kpis.d1).toEqual({ count: 0, base: 0, share: null });
    expect(data.cohorts.rows).toHaveLength(1);
    expect(data.cohorts.rows[0].cells.every((cell) => cell.share === null && cell.count === null)).toBe(true);
  });

  it("пустая кампания: нули, прочерки, без деления на ноль", async () => {
    const ctx = newAdventService();
    const data = await loadAdventAnalytics(ctx.repository, ctx.advent, at(3, 12), await ctx.rewards.overview());
    expect(data.kpis).toMatchObject({ participants: 0, players: 0, activeToday: 0, doorsAvg: null, redeemed: 0 });
    expect(data.kpis.d1).toEqual({ count: 0, base: 0, share: null });
    expect(data.doors).toMatchObject({ avg: null, median: null, buckets: [] });
    expect(data.days.filter((day) => day.status !== "future").every((day) => day.opened === 0 && day.onTimeShare === null)).toBe(true);
    expect(data.registration.every((step) => step.count === 0 && step.share === null)).toBe(true);
    expect(data.insights.map((insight) => insight.key)).toEqual(["few-data"]);
  });

  it("до старта все окна будущие, а сутки делит часовой пояс кампании", async () => {
    const ctx = newAdventService();
    const before = await loadAdventAnalytics(ctx.repository, ctx.advent, new Date("2026-12-19T20:59:59Z"), await ctx.rewards.overview());
    expect(before.phase).toBe("upcoming");
    expect(before.today).toBeNull();
    expect(before.days.every((day) => day.status === "future")).toBe(true);
    // 19.12 21:00 UTC — это 00:00 МСК 20.12: день 1 открывается ровно в этот момент.
    const open = await loadAdventAnalytics(ctx.repository, ctx.advent, new Date("2026-12-19T21:00:00Z"), await ctx.rewards.overview());
    expect(open.today).toBe(1);
    expect(open.days[0].status).toBe("running");
    expect(open.days[0].date).toBe(dayLocalDate(1, ctx.advent.schedule));
  });
});

describe("команды (corporate)", () => {
  const teams = [
    { id: "t-north", title: "Север" },
    { id: "t-south", title: "Юг" },
    { id: "t-east", title: "Восток" }
  ];
  const config = () => adventConfig((draft) => { draft.audience = { kind: "employees", leaderboard: "teams", teams }; });

  async function join(ctx: ReturnType<typeof newAdventService>, teamId: string, count: number, opens: number) {
    for (let index = 0; index < count; index += 1) {
      const { participant } = await ctx.service.createParticipant(at(1, 9));
      await ctx.service.setTeam(participant.id, teamId, at(1, 9));
      for (let day = 1; day <= opens; day += 1) await ctx.service.openDay(participant.id, day, at(day, 10));
    }
  }

  it("рейтинг по среднему, малые команды скрыты в панели (порог 5) и в публичном рейтинге (порог 3)", async () => {
    const ctx = newAdventService(config());
    await join(ctx, "t-north", 6, 3); // 6 человек × 3 двери: среднее 3,0
    await join(ctx, "t-south", 4, 4); // 4 человека × 4 двери: среднее 4,0 — видна в публичном (≥3), скрыта в панели (<5)
    await join(ctx, "t-east", 2, 4); // 2 человека: скрыта везде
    const now = at(4, 12);
    const data = await loadAdventAnalytics(ctx.repository, ctx.advent, now, await ctx.rewards.overview());
    expect(data.teams!.map((team) => [team.id, team.rank, team.hidden, team.members, team.avgDoors])).toEqual([
      ["t-north", 1, false, 6, 3],
      ["t-east", null, true, null, null],
      ["t-south", null, true, null, null]
    ]);
    expect(data.teams![0]).toMatchObject({ activeShare: 1, points: 0 });

    const board = await loadTeamLeaderboard(ctx.repository, ctx.advent, now, "t-south");
    expect(board!.mine).toBe("t-south");
    expect(board!.teams.map((team) => [team.id, team.rank, team.hidden, team.members, team.avgDoors])).toEqual([
      ["t-south", 1, false, 4, 4],
      ["t-north", 2, false, 6, 3],
      ["t-east", null, true, null, null]
    ]);
    // В публичном ответе нет ничего, кроме агрегатов.
    expect(JSON.stringify(board)).not.toMatch(/participant|email|accessKey/i);
  });

  it("публичный рейтинг кэшируется на несколько минут", async () => {
    const ctx = newAdventService(config());
    await join(ctx, "t-north", 3, 1);
    const now = at(2, 12);
    const first = await loadTeamLeaderboard(ctx.repository, ctx.advent, now, null);
    await join(ctx, "t-north", 3, 1);
    const cached = await loadTeamLeaderboard(ctx.repository, ctx.advent, new Date(now.getTime() + LEADERBOARD_TTL_MS - 1000), null);
    expect(cached!.teams[0].members).toBe(first!.teams[0].members);
    const fresh = await loadTeamLeaderboard(ctx.repository, ctx.advent, new Date(now.getTime() + LEADERBOARD_TTL_MS), null);
    expect(fresh!.teams[0].members).toBe(6);
  });

  it("одновременные запросы после истечения кэша ждут один пересчёт; ошибка в кэше не застревает", async () => {
    const ctx = newAdventService(config());
    await join(ctx, "t-north", 3, 1);
    let calls = 0;
    const counting = { teamStats: (slug: string) => { calls += 1; return ctx.repository.teamStats(slug); } };
    const now = at(2, 12);
    const boards = await Promise.all(Array.from({ length: 5 }, () => loadTeamLeaderboard(counting, ctx.advent, now, null)));
    expect(calls).toBe(1);
    expect(new Set(boards.map((board) => board!.teams[0].members))).toEqual(new Set([3]));

    clearLeaderboardCache();
    let failNext = true;
    const flaky = { teamStats: async (slug: string) => { if (failNext) { failNext = false; throw new Error("db down"); } return ctx.repository.teamStats(slug); } };
    await expect(loadTeamLeaderboard(flaky, ctx.advent, now, null)).rejects.toThrow("db down");
    expect((await loadTeamLeaderboard(flaky, ctx.advent, now, null))!.teams[0].members).toBe(3);
  });

  it("без рейтинга по командам загрузчик возвращает null", async () => {
    const ctx = newAdventService();
    expect(await loadTeamLeaderboard(ctx.repository, ctx.advent, at(2, 12), null)).toBeNull();
  });

  it("выбор команды: только своя из списка, до финала, идемпотентно", async () => {
    const ctx = newAdventService(config());
    const { participant } = await ctx.service.createParticipant(at(1, 9));
    const state = await ctx.service.setTeam(participant.id, "t-south", at(1, 9));
    expect(state.team).toEqual({ options: teams, selected: "t-south", canChange: true });
    expect((await ctx.service.setTeam(participant.id, "t-south", at(1, 9))).team!.selected).toBe("t-south");
    await expect(ctx.service.setTeam(participant.id, "нет-такой", at(1, 9))).rejects.toMatchObject({ code: "invalid" });
    expect((await ctx.service.setTeam(participant.id, null, at(1, 9))).team!.selected).toBeNull();
    await expect(ctx.service.setTeam(participant.id, "t-north", new Date("2027-01-01T12:00:00+03:00"))).rejects.toMatchObject({ code: "conflict" });
    const plain = newAdventService();
    const solo = (await plain.service.createParticipant(at(1, 9))).participant;
    await expect(plain.service.setTeam(solo.id, "t-north", at(1, 9))).rejects.toMatchObject({ code: "conflict" });
    expect((await plain.service.state(solo.id, at(1, 9))).team).toBeNull();
  });
});

describe("CSV метрик", () => {
  it("защита от формул в названиях дней и наград (из пакета клиента)", async () => {
    const ctx = newAdventService(adventConfig((draft) => { draft.days[0].title = "=HYPERLINK(\"http://x\")"; draft.rewards[0].label = "+cmd|' /C calc'!A0"; }));
    const data = await loadAdventAnalytics(ctx.repository, ctx.advent, at(2, 12), await ctx.rewards.overview());
    const days = daysMetricsToCsv(data.days);
    expect(days).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(days.split("\r\n")[0]).toContain("Открыли в свой день");
    const rewards = rewardsMetricsToCsv(data.rewards);
    expect(rewards).toContain(`"'+cmd|' /C calc'!A0"`);
    expect(rewards.startsWith("﻿")).toBe(true);
  });

  it("когорты: скрытые строки без чисел, числа не получают апостроф", () => {
    const csv = cohortsMetricsToCsv({ offsets: [1], rows: [
      { date: "2026-12-20", size: null, hidden: true, cells: [{ offset: 1, count: null, share: null }] },
      { date: "2026-12-21", size: 10, hidden: false, cells: [{ offset: 1, count: 4, share: 0.4 }] }
    ] });
    expect(csv.split("\r\n").slice(1, 3)).toEqual([`"2026-12-20","","",""`, `"2026-12-21","10","4","0.4"`]);
  });
});
