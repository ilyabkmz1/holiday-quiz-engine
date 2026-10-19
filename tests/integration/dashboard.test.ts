import { describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import { getPrisma } from "@/server/db";
import { loadAdminClaims, loadDashboardMetrics } from "@/server/metrics";

import {
  markClaimsExported,
  api,
  clock,
  completedPlayer,
  installFakes,
  playAllRooms,
  playRoom,
  startRush,
  startSession,
  verifiedClaim
} from "./helpers/app";
import { partialPayload, wrongPayload, correctPayload } from "../support/solve";

const step = (name: string, funnel: { key: string; count: number }[]) => funnel.find((item) => item.key === name)?.count;
const DAY = 24 * 60 * 60 * 1000;

describe("loadDashboardMetrics", () => {
  it("returns zeros for an empty database, with every task, room and level present", async () => {
    installFakes();
    const metrics = await loadDashboardMetrics(getPrisma(), campaign);

    expect(metrics.funnel.every((item) => item.count === 0)).toBe(true);
    expect(metrics.funnel).toHaveLength(1 + campaign.rooms.length * 2 + 6);
    expect(metrics.daily).toEqual([]);
    expect(metrics.tasks).toHaveLength(15);
    expect(metrics.tasks.every((task) => task.answers === 0 && task.fullShare === null)).toBe(true);
    expect(metrics.levels.map((level) => level.title)).toEqual(campaign.rewardTiers.map((tier) => tier.title));
    expect(metrics.levels.every((level) => level.count === 0 && level.share === null)).toBe(true);
    expect(metrics.timing).toEqual({ completedCount: 0, avgSeconds: null, medianSeconds: null });
  });

  it("builds the funnel, daily rows, task shares, levels and timing from real sessions", async () => {
    const mailer = installFakes();
    // День 1 (24.12): полное прохождение, заявка, подтверждение, выгрузка.
    await verifiedClaim(mailer, { email: "funnel.one@example.com" });
    await markClaimsExported();
    // Заявка без подтверждения: полное прохождение + claim_pending.
    const pending = await completedPlayer();
    await api.claim(pending.sessionId, pending.accessKey, {
      name: "Пётр Иванов", email: "funnel.two@example.com", company: "Компания", consent: true
    });

    // День 2 (25.12): игрок застрял на комнате «mail» (одна ошибка на 0, одно 50, одно 100) и в рывок не дошёл.
    clock.advance(DAY);
    const stuck = await startSession();
    const mail = campaign.rooms.find((room) => room.id === "mail")!;
    await playRoom(stuck, "mail", {
      payloadFor: (task, index) => (index === 0 ? wrongPayload(task) : index === 1 ? (partialPayload(task) ?? correctPayload(task)) : correctPayload(task))
    });
    // И ещё один только начал, в комнату не входил.
    await startSession();

    const metrics = await loadDashboardMetrics(getPrisma(), campaign);

    expect(step("started", metrics.funnel)).toBe(4);
    expect(step("room_entered:mail", metrics.funnel)).toBe(3);
    expect(step("room_completed:mail", metrics.funnel)).toBe(3);
    expect(step("room_entered:projects", metrics.funnel)).toBe(2);
    expect(step("rush_started", metrics.funnel)).toBe(2);
    expect(step("rush_finished", metrics.funnel)).toBe(2);
    expect(step("completed", metrics.funnel)).toBe(2);
    expect(step("claim_created", metrics.funnel)).toBe(2);
    expect(step("verified", metrics.funnel)).toBe(1);
    expect(step("exported", metrics.funnel)).toBe(1);

    expect(metrics.daily.map((row) => row.date)).toEqual(["2026-12-25", "2026-12-24"]);
    const [day2, day1] = metrics.daily;
    expect(day1).toMatchObject({
      started: 2, roomsEntered: 10, roomsCompleted: 10, rushStarted: 2, rushFinished: 2,
      completed: 2, claimsCreated: 2, verified: 1, exported: 1
    });
    expect(day2).toMatchObject({
      started: 2, roomsEntered: 1, roomsCompleted: 1, rushStarted: 0, rushFinished: 0,
      completed: 0, claimsCreated: 0, verified: 0, exported: 0
    });

    // По заданиям «mail»: два идеальных прохождения + один игрок (0, 50 или 100 по ситуации).
    const firstMailTask = metrics.tasks.find((task) => task.taskId === mail.tasks[0].id)!;
    expect(firstMailTask).toMatchObject({ answers: 3, full: 2, partial: 0, wrong: 1 });
    expect(firstMailTask.fullShare).toBeCloseTo(2 / 3);
    const untouched = metrics.tasks.find((task) => task.roomTitle !== mail.title && task.answers === 2)!;
    expect(untouched).toMatchObject({ full: 2, partial: 0, wrong: 0, fullShare: 1 });
    const secondMail = metrics.tasks.find((task) => task.taskId === mail.tasks[1].id)!;
    expect(secondMail.full + secondMail.partial + secondMail.wrong).toBe(3);

    // Уровни: оба завершивших получили одинаковый уровень, сумма долей = 1.
    expect(metrics.levels.reduce((sum, level) => sum + level.count, 0)).toBe(2);
    expect(metrics.levels.reduce((sum, level) => sum + (level.share ?? 0), 0)).toBeCloseTo(1);
    // Часы неподвижны, пока игра идёт: время прохождения нулевое, но считается по двум играм.
    expect(metrics.timing.completedCount).toBe(2);
    expect(metrics.timing.avgSeconds).toBe(0);
    expect(metrics.timing.medianSeconds).toBe(0);
  });

  it("counts a day by Moscow time, not UTC", async () => {
    installFakes(new Date("2026-12-24T22:30:00Z")); // 01:30 25.12 по Москве
    await startSession();

    const metrics = await loadDashboardMetrics(getPrisma(), campaign);

    expect(metrics.daily.map((row) => row.date)).toEqual(["2026-12-25"]);
  });

  it("averages completion time over finished sessions only", async () => {
    installFakes();
    const player = await startSession();
    clock.advance(60_000);
    await playRoomsAndFinish(player);
    await startSession(); // не завершил: во времени не участвует
    const metrics = await loadDashboardMetrics(getPrisma(), campaign);

    expect(metrics.timing.completedCount).toBe(1);
    expect(metrics.timing.avgSeconds).toBeGreaterThanOrEqual(60);
  });

  it("contains no email, name or session identifiers", async () => {
    const mailer = installFakes();
    const { player, input } = await verifiedClaim(mailer, { email: "secret.person@example.com" });
    const text = JSON.stringify(await loadDashboardMetrics(getPrisma(), campaign));

    for (const value of [input.email.toLowerCase(), input.name, input.company, player.sessionId, player.accessKey, "secret.person"]) {
      expect(text).not.toContain(value);
    }
  });

  it("does not mix in other campaigns", async () => {
    installFakes();
    await startSession();
    const metrics = await loadDashboardMetrics(getPrisma(), { ...campaign, slug: "another-campaign" });

    expect(step("started", metrics.funnel)).toBe(0);
  });
});

async function playRoomsAndFinish(player: Awaited<ReturnType<typeof startSession>>) {
  await playAllRooms(player);
  await startRush(player);
  await api.rushFinish(player.sessionId, player.accessKey);
  clock.advance(1000);
  await api.complete(player.sessionId, player.accessKey);
}

describe("loadAdminClaims", () => {
  it("masks emails and exposes no names, companies or full addresses", async () => {
    const mailer = installFakes();
    const { input } = await verifiedClaim(mailer, { email: "Anna.Petrova@Company.RU", name: "Анна Петрова", company: "Секретная Компания" });

    const claims = await loadAdminClaims(getPrisma(), campaign);
    const text = JSON.stringify(claims);

    expect(claims.total).toBe(1);
    expect(claims.byStatus).toEqual({ claim_pending: 0, email_verified: 1, exported: 0, fulfilled: 0 });
    expect(claims.rows).toHaveLength(1);
    expect(claims.rows[0]).toMatchObject({ maskedEmail: "a***@company.ru", status: "email_verified" });
    expect(claims.rows[0].level).toBeTruthy();
    for (const secret of [input.email.toLowerCase(), "anna.petrova", "Анна", "Петрова", "Секретная"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("limits the table but still counts every claim", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "one@example.com" });
    await verifiedClaim(mailer, { email: "two@example.com" });
    await verifiedClaim(mailer, { email: "three@example.com" });

    const claims = await loadAdminClaims(getPrisma(), campaign, 2);

    expect(claims.total).toBe(3);
    expect(claims.rows).toHaveLength(2);
  });

  it("shows the exported status after the CSV download", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "export@example.com" });
    await markClaimsExported();

    const claims = await loadAdminClaims(getPrisma(), campaign);

    expect(claims.rows[0].status).toBe("exported");
    const stored = await getPrisma().prizeClaim.findFirstOrThrow();
    expect(stored.exportedAt?.toISOString()).toBe(clock.value.toISOString());
  });
});
