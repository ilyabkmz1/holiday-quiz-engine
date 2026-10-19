import { describe, expect, it } from "vitest";

import { campaign as officeCampaign } from "@tenants/demo-office/campaign";
import { maxScore, summarizeRoom } from "@/domain/scoring";
import { publicCampaign, publicTask } from "@/server/presentation";
import { InMemorySessionRepository } from "@/server/repositories/in-memory-session-repository";
import { SessionService } from "@/server/services/session-service";

import { FakeClock } from "../support/clock";
import { smallCampaign } from "../support/small-campaign";
import { correctPayload } from "../support/solve";

const START = new Date("2026-12-24T12:00:00Z");

describe("кампания с другими количествами (3 зоны × 2 задания)", () => {
  const campaign = smallCampaign();

  it("пороги в процентах переведены от максимума, посчитанного по составу кампании", () => {
    const max = maxScore(campaign.rooms.map((room) => room.tasks.length));
    expect(campaign.rewardTiers.map((tier) => tier.minScore)).toEqual([0, Math.round(max * 0.4), Math.round(max * 0.75)]);
  });

  it("комната из двух заданий завершается после второго ответа и даёт «без сбоев» и скорость по своей базе", () => {
    const summary = summarizeRoom(
      "a",
      [
        { base: 100, comboBonus: 0, durationMs: 5_000 },
        { base: 100, comboBonus: 25, durationMs: 5_000 }
      ],
      2
    );
    expect(summary).toMatchObject({ completed: true, base: 200, noFailBonus: 50, speedBonus: 130 });
    // Без указания размера комнаты по умолчанию действует прежнее правило «три задания».
    expect(summarizeRoom("a", [{ base: 100, comboBonus: 0, durationMs: 0 }, { base: 100, comboBonus: 25, durationMs: 0 }]).completed).toBe(false);
  });

  it("идеальное прохождение по сервису даёт верхний уровень, а ответ на чужой сессии — «не найдено»", async () => {
    const clock = new FakeClock(START);
    const repository = new InMemorySessionRepository();
    const service = new SessionService(repository, campaign, clock.now);
    const { session } = await service.create();

    for (const room of campaign.rooms) {
      await service.enterRoom(session.id, room.id);
      for (const task of room.tasks) {
        await service.roomTask(session.id, room.id);
        clock.advance(2_000);
        await service.answerTask(session.id, task.id, correctPayload(task));
      }
    }
    const progress = await service.progress(session.id);
    expect(progress.roomsCompleted).toBe(3);
    expect(progress.rushUnlocked).toBe(true);

    // Сервис другого арендатора не видит эту сессию.
    const other = new SessionService(repository, smallCampaign("other-tenant"), clock.now);
    await expect(other.get(session.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("публичное представление не отдаёт признаки правильности ни в одном блоке", () => {
  const FORBIDDEN_KEYS = [
    "correctOptionId",
    "correctOptionIds",
    "fakeLetterId",
    "correctEnabledIds",
    "correctOrder",
    "explanation",
    "tip",
    "thanks",
    "oops"
  ];

  it.each([
    ["demo-office", officeCampaign],
    ["small", smallCampaign()]
  ])("пакет %s: задания", (_name, campaign) => {
    const types = new Set<string>();
    for (const room of campaign.rooms) {
      for (const task of room.tasks) {
        types.add(task.type);
        const json = JSON.stringify(publicTask(room.id, task, "session-1"));
        for (const key of FORBIDDEN_KEYS) expect(json).not.toContain(`"${key}"`);
      }
    }
    expect(types.size).toBeGreaterThan(0);
  });

  it("кампания целиком: ни ответов, ни пула рывка, ни разборов", () => {
    const text = JSON.stringify(publicCampaign(officeCampaign));
    for (const key of FORBIDDEN_KEYS) expect(text).not.toContain(`"${key}"`);
    expect(text).not.toContain('"pool"');
    expect(text).not.toContain('"policyText"');
  });
});
