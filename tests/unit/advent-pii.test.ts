import { describe, expect, it } from "vitest";

import { adventPiiDueAt, cleanupAdventPii, DEFAULT_ADVENT_PII_RETENTION_DAYS, parseRetentionDays } from "@/server/advent-pii";
import { InMemoryAdventRepository } from "@/server/repositories/in-memory-advent-repository";

import { CAMPAIGN, OTHER_CAMPAIGN, participantRecord, tokenRecord } from "../support/advent-repository-contract";

const schedule = (claimEndsAt: string) => ({ schedule: { claimEndsAt } }) as unknown as Parameters<typeof adventPiiDueAt>[0];

describe("очистка ПДн адвента", () => {
  it("срок хранения: по умолчанию 30 суток, целое число от 0, мусор — ошибка", () => {
    expect(parseRetentionDays(undefined)).toBe(DEFAULT_ADVENT_PII_RETENTION_DAYS);
    expect(parseRetentionDays("")).toBe(30);
    expect(parseRetentionDays("0")).toBe(0);
    expect(parseRetentionDays(" 45 ")).toBe(45);
    for (const raw of ["-1", "1.5", "тридцать"]) expect(() => parseRetentionDays(raw)).toThrow(/ADVENT_PII_RETENTION_DAYS/);
  });

  it("граница — claimEndsAt плюс срок хранения", () => {
    expect(adventPiiDueAt(schedule("2027-01-10T00:00:00+03:00"), 30).toISOString()).toBe("2027-02-08T21:00:00.000Z");
  });

  it("стирает email только у кампаний с истёкшим сроком; устаревшие ссылки входа удаляются всегда", async () => {
    const repository = new InMemoryAdventRepository();
    const done = await repository.createParticipant(participantRecord({ normalizedEmail: "done@example.test", consentAt: new Date("2026-12-20T00:00:00Z") }));
    const running = await repository.createParticipant(participantRecord({ campaignSlug: OTHER_CAMPAIGN, normalizedEmail: "running@example.test" }));
    await repository.createLoginToken(tokenRecord(running.id, "x@example.test", { expiresAt: new Date("2027-01-01T00:00:00Z") }));
    const advents = [
      { slug: CAMPAIGN, ...schedule("2027-01-10T00:00:00+03:00") },
      { slug: OTHER_CAMPAIGN, ...schedule("2027-03-01T00:00:00+03:00") }
    ];

    const before = await cleanupAdventPii(repository, advents, new Date("2027-02-08T20:59:59Z"), 30);
    expect(before).toEqual({ deletedLoginTokens: 1, anonymizedParticipants: 0, campaigns: [] });
    expect((await repository.getParticipant(done.id))?.normalizedEmail).toBe("done@example.test");

    const after = await cleanupAdventPii(repository, advents, new Date("2027-02-08T21:00:00Z"), 30);
    expect(after).toEqual({ deletedLoginTokens: 0, anonymizedParticipants: 1, campaigns: [CAMPAIGN] });
    expect(await repository.getParticipant(done.id)).toMatchObject({ normalizedEmail: null, consentAt: null });
    expect((await repository.getParticipant(running.id))?.normalizedEmail).toBe("running@example.test");
    expect((await repository.findParticipantByAccessKeyHash(done.accessKeyHash))?.id).toBe(done.id);
  });
});
