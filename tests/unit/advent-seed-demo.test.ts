import { describe, expect, it } from "vitest";

import { loadAdventAnalytics } from "@/server/advent-metrics";
import { InMemoryAdventRepository } from "@/server/repositories/in-memory-advent-repository";
import { AdventService } from "@/server/services/advent-service";
import { RewardService } from "@/server/services/reward-service";
import { decayFor, seedDemoAdvent, seededRandom } from "@/tools/advent-seed-demo";

import { adventConfig, TEST_QR_SECRET } from "../support/advent";

const THROUGH = new Date("2026-12-31T23:00:00+03:00");

async function seeded(seed: number, participants = 220, patch: (draft: Record<string, any>) => void = () => undefined) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const advent = adventConfig(patch);
  const repository = new InMemoryAdventRepository();
  const rewards = new RewardService(repository, advent, { qrSecret: TEST_QR_SECRET, baseUrl: "https://demo.example.test", rng: seededRandom(seed) });
  const service = new AdventService(repository, advent, rewards);
  const report = await seedDemoAdvent({ repository, service, advent }, { participants, seed, through: THROUGH });
  const data = await loadAdventAnalytics(repository, advent, THROUGH, await rewards.overview());
  return { advent, repository, report, data };
}

describe("advent:seed-demo: синтетические участники", () => {
  it("зерно задаёт спад к концу кампании от 10 до 40%", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const decay = decayFor(seed);
      expect(decay).toBeGreaterThanOrEqual(0.1);
      expect(decay).toBeLessThan(0.4);
    }
  });

  it("детерминированно: то же зерно — те же числа, другое зерно — другие", { timeout: 30_000 }, async () => {
    const a = await seeded(7, 50);
    const b = await seeded(7, 50);
    const c = await seeded(8, 50);
    expect(a.report).toEqual(b.report);
    expect(a.data.days).toEqual(b.data.days);
    expect(c.report).not.toEqual(a.report);
  });

  it("наполняет панель: участники, открытия, награды, погашения и напоминания", { timeout: 30_000 }, async () => {
    const { report, data } = await seeded(1);
    expect(report.participants).toBe(220);
    expect(data.kpis.participants).toBe(220);
    expect(data.kpis.players).toBeGreaterThan(150);
    expect(report.verified).toBeGreaterThan(20);
    expect(data.rewards.find((reward) => reward.rewardId === "daily-gift")!.issued).toBeGreaterThan(50);
    expect(data.kpis.redeemed).toBeGreaterThan(5);
    expect(data.reminders!.sent).toBeGreaterThan(0);
    expect(data.reminders!.openedAfter).toBeLessThanOrEqual(data.reminders!.sent);
    // Выводы больше не «мало данных».
    expect(data.insights.map((insight) => insight.key)).not.toContain("few-data");
  });

  it("реалистичный спад: доля открывших в свой день к концу ниже, чем в начале, но не обвал", { timeout: 60_000 }, async () => {
    for (const seed of [1, 2]) {
      const { data } = await seeded(seed, 300);
      const shares = data.days.filter((day) => day.active >= 5).map((day) => day.onTimeShare!);
      const third = Math.floor(shares.length / 3);
      const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const first = mean(shares.slice(0, third));
      const last = mean(shares.slice(-third));
      expect(last, `зерно ${seed}`).toBeLessThan(first);
      expect(last / first, `зерно ${seed}`).toBeGreaterThan(0.45);
    }
  });

  it("только синтетика: адреса example.test, ПДн и токенов нет", async () => {
    const { repository } = await seeded(3, 80);
    const people = [...(repository as unknown as { participants: Map<string, { normalizedEmail: string | null }> }).participants.values()];
    const emails = people.map((person) => person.normalizedEmail).filter((email): email is string => email !== null);
    expect(emails.length).toBeGreaterThan(5);
    expect(emails.every((email) => /^demo-\d+-\d+@seed\.example\.test$/.test(email))).toBe(true);
  });

  it("команды: распределение с одной малой командой, участники разных размеров", { timeout: 30_000 }, async () => {
    const teams = [{ id: "a", title: "А" }, { id: "b", title: "Б" }, { id: "c", title: "В" }, { id: "d", title: "Г" }];
    const { data } = await seeded(5, 300, (draft) => { draft.audience = { kind: "employees", leaderboard: "teams", teams }; });
    const hidden = data.teams!.filter((team) => team.hidden);
    const shown = data.teams!.filter((team) => !team.hidden);
    expect(shown.length).toBeGreaterThanOrEqual(2);
    expect(hidden.length).toBeLessThanOrEqual(1);
    expect(shown.map((team) => team.rank)[0]).toBe(1);
  });

  it("до старта кампании ничего не создаёт", async () => {
    const advent = adventConfig();
    const repository = new InMemoryAdventRepository();
    const service = new AdventService(repository, advent);
    const report = await seedDemoAdvent({ repository, service, advent }, { participants: 10, seed: 1, through: new Date("2026-12-01T00:00:00Z") });
    expect(report.participants).toBe(0);
  });

  it("не заходит за финал: время ограничено моментом финала", async () => {
    const advent = adventConfig();
    const repository = new InMemoryAdventRepository();
    const service = new AdventService(repository, advent, new RewardService(repository, advent, { qrSecret: TEST_QR_SECRET, baseUrl: "https://demo.example.test", rng: seededRandom(2) }));
    await seedDemoAdvent({ repository, service, advent }, { participants: 40, seed: 2, through: new Date("2027-03-01T00:00:00+03:00") });
    const opens = [...(repository as unknown as { opens: Map<string, { openedAt: Date }> }).opens.values()];
    expect(opens.length).toBeGreaterThan(20);
    expect(Math.max(...opens.map((open) => open.openedAt.getTime()))).toBeLessThan(new Date(advent.schedule.finaleAt).getTime());
  });
});
