import { afterEach, describe, expect, it, vi } from "vitest";

import { adventPackSchema } from "@/config/pack";
import type { MailVars } from "@/server/mailer";
import { runAdventReminders } from "@/server/advent-reminders-run";
import { InMemoryAdventRepository } from "@/server/repositories/in-memory-advent-repository";
import { DEFAULT_REMINDER_OPTIONS } from "@/server/services/reminder-service";
import type { AdventTenant } from "@/server/tenants";

import { adventPackFixture } from "../fixtures/advent";
import { at, newAdventService, verifyParticipant } from "../support/advent";

function tenantOf(patch: (pack: Record<string, any>) => void = () => undefined): AdventTenant { // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw = adventPackFixture();
  patch(raw);
  const pack = adventPackSchema.parse(raw);
  return { ...pack, advent: pack.advent } as unknown as AdventTenant;
}

async function world(tenant: AdventTenant) {
  const base = newAdventService(tenant.advent);
  const { participant } = await base.service.createParticipant(at(1, 9));
  const verified = await verifyParticipant(base, participant.id, at(1, 9), "demo@example.test");
  await base.repository.setReminderOptIn(verified.id, true, at(1, 9));
  return base;
}

const OPTIONS = { ...DEFAULT_REMINDER_OPTIONS, ratePerSecond: 0 };

afterEach(() => vi.restoreAllMocks());

describe("runAdventReminders", () => {
  async function run(tenant: AdventTenant, repository: InMemoryAdventRepository, env: Record<string, string | undefined>, sent: string[] = []) {
    const reports = await runAdventReminders({
      tenants: [tenant],
      env,
      now: () => at(2, 9),
      appUrl: "https://advent.test",
      options: OPTIONS,
      repositoryFor: () => repository,
      send: async (email: string, vars: MailVars["reminder"]) => {
        sent.push(`${email}|${vars.dayNumber}`);
      }
    });
    return { reports, sent };
  }

  it("боевой пакет получает письмо; отчёт — только счётчики без адресов", async () => {
    const tenant = tenantOf();
    const base = await world(tenant);
    const { reports, sent } = await run(tenant, base.repository, {});
    expect(sent).toEqual(["demo@example.test|2"]);
    expect(reports).toEqual([{ tenant: "zerno-advent", skipped: null, day: 2, claimed: 1, sent: 1, failed: 0, lostClaims: 0 }]);
    expect(JSON.stringify(reports)).not.toContain("@");
  });

  it("демо-пакет писем не шлёт без ADVENT_REMINDERS_DEMO=true", async () => {
    const tenant = tenantOf((pack) => {
      pack.demo = true;
    });
    const base = await world(tenant);
    const skipped = await run(tenant, base.repository, {});
    expect(skipped.sent).toEqual([]);
    expect(skipped.reports[0]).toMatchObject({ skipped: "demo", sent: 0 });
    const allowed = await run(tenant, base.repository, { ADVENT_REMINDERS_DEMO: "true" });
    expect(allowed.sent).toEqual(["demo@example.test|2"]);
    // Другое значение флага не включает отправку.
    const other = tenantOf((pack) => {
      pack.demo = true;
    });
    expect((await run(other, (await world(other)).repository, { ADVENT_REMINDERS_DEMO: "1" })).sent).toEqual([]);
  });

  it("арендатор без email-рассылки пропускается молча", async () => {
    const tenant = tenantOf((pack) => {
      pack.advent.reminders.channel = "off";
    });
    const base = await world(tenant);
    const { reports, sent } = await run(tenant, base.repository, {});
    expect(reports).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("ADVENT_REMIND_AS_OF сдвигает время вне production и в демо; в production на боевом пакете игнорируется", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tenant = tenantOf();
    const base = await world(tenant);
    // Часы сервера — день 2, 09:00; AS_OF переносит на день 4 (вне production).
    const shifted = await run(tenant, base.repository, { ADVENT_REMIND_AS_OF: "2026-12-23T09:00:00+03:00", NODE_ENV: "development" });
    expect(shifted.sent).toEqual(["demo@example.test|4"]);

    const prod = tenantOf();
    const prodBase = await world(prod);
    const ignored = await run(prod, prodBase.repository, { ADVENT_REMIND_AS_OF: "2026-12-23T09:00:00+03:00", NODE_ENV: "production" });
    expect(ignored.sent).toEqual(["demo@example.test|2"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("advent_remind_as_of_ignored"));

    const demo = tenantOf((pack) => {
      pack.demo = true;
    });
    const demoBase = await world(demo);
    const demoRun = await run(demo, demoBase.repository, { ADVENT_REMINDERS_DEMO: "true", ADVENT_REMIND_AS_OF: "2026-12-23T09:00:00+03:00", NODE_ENV: "production" });
    expect(demoRun.sent).toEqual(["demo@example.test|4"]);
  });

  it("сбой одного арендатора не оставляет без писем остальных; в отчёте только `error` без текста ошибки", async () => {
    const broken = tenantOf((pack) => {
      pack.tenant = "broken-advent";
    });
    const healthy = tenantOf();
    const brokenBase = await world(broken);
    const healthyBase = await world(healthy);
    vi.spyOn(brokenBase.repository, "listReminderCandidates").mockRejectedValue(new Error("connect ECONNREFUSED demo@example.test"));
    const sent: string[] = [];
    const reports = await runAdventReminders({
      tenants: [broken, healthy],
      env: {},
      now: () => at(2, 9),
      appUrl: "https://advent.test",
      options: OPTIONS,
      repositoryFor: (tenant) => (tenant.tenant === "broken-advent" ? brokenBase.repository : healthyBase.repository),
      send: async (email: string, vars: MailVars["reminder"]) => {
        sent.push(`${email}|${vars.dayNumber}`);
      }
    });
    expect(reports).toEqual([
      { tenant: "broken-advent", skipped: "error", day: null, claimed: 0, sent: 0, failed: 0, lostClaims: 0 },
      { tenant: "zerno-advent", skipped: null, day: 2, claimed: 1, sent: 1, failed: 0, lostClaims: 0 }
    ]);
    expect(sent).toEqual(["demo@example.test|2"]);
    expect(JSON.stringify(reports)).not.toContain("@");
  });

  it("дата без смещения отвергается", async () => {
    const tenant = tenantOf();
    const base = await world(tenant);
    await expect(run(tenant, base.repository, { ADVENT_REMIND_AS_OF: "2026-12-23T09:00:00", NODE_ENV: "development" })).rejects.toThrow(/ADVENT_REMIND_AS_OF/);
    await expect(run(tenant, base.repository, { ADVENT_REMIND_AS_OF: "завтра", NODE_ENV: "development" })).rejects.toThrow(/ADVENT_REMIND_AS_OF/);
  });
});
