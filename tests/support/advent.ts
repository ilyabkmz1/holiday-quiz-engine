import { adventSchema, type AdventConfig } from "@/config/advent-schema";
import { correctPayload } from "@/domain/solve";
import { InMemoryAdventRepository } from "@/server/repositories/in-memory-advent-repository";
import { AdventService } from "@/server/services/advent-service";
import { IdentityService } from "@/server/services/identity-service";
import { RewardService, type RewardServiceOptions } from "@/server/services/reward-service";
import type { ParticipantRecord } from "@/server/repositories/advent-repository";

import { adventFixture } from "../fixtures/advent";

/** Конфигурация адвента из фикстуры (12 дней, 20–31.12.2026, Europe/Moscow), опционально с правками. */
export function adventConfig(patch: (draft: Record<string, any>) => void = () => undefined): AdventConfig { // eslint-disable-line @typescript-eslint/no-explicit-any
  const draft = adventFixture();
  patch(draft);
  return adventSchema.parse(draft);
}

/** Момент в день n фикстуры (день 1 — 20.12.2026) по московскому времени. */
export function at(n: number, hour = 12, minute = 0): Date {
  const day = String(19 + n).padStart(2, "0");
  return new Date(`2026-12-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`);
}

export const TEST_QR_SECRET = "test-reward-qr-secret-0123456789abcdef0123456789";

/** Детерминированный источник случайности для кодов: mulberry32 по зерну. */
export function seededRng(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type AuditEntry = { event: string; entityId: string | null; metadata?: Record<string, unknown> };

export function newAdventService(advent: AdventConfig = adventConfig(), options: RewardServiceOptions = {}) {
  const repository = new InMemoryAdventRepository();
  const audit: AuditEntry[] = [];
  const rewards = new RewardService(repository, advent, {
    qrSecret: TEST_QR_SECRET,
    baseUrl: "https://advent.test",
    rng: seededRng(7),
    audit: async (event, entityId, metadata) => {
      audit.push({ event, entityId, metadata });
    },
    ...options
  });
  return { repository, advent, rewards, audit, service: new AdventService(repository, advent, rewards) };
}

type Ctx = ReturnType<typeof newAdventService>;

/**
 * Подтверждённый вход участника по email (как по ссылке из письма): запрос ссылки и её подтверждение на этом же устройстве,
 * затем дозаполнение кодов. Возвращает обновлённую запись участника.
 */
export async function verifyParticipant(ctx: Pick<Ctx, "repository" | "advent" | "service">, participantId: string, now: Date, email = `${participantId}@example.test`): Promise<ParticipantRecord> {
  let token = "";
  const identity = new IdentityService({
    repository: ctx.repository,
    advent: ctx.advent,
    verifyEndpoint: "https://advent.test/api/advent/identity/verify",
    sendLoginLink: async (_email, link) => {
      token = new URL(link).searchParams.get("token")!;
    },
    onVerified: (id, at) => ctx.service.ensureCodes(id, at)
  });
  await identity.requestLink(participantId, { email, consent: true, marketingConsent: false, reminderOptIn: false }, now);
  const current = await ctx.repository.getParticipant(participantId);
  const { participant } = await identity.verify(token, current, now);
  return participant;
}

/**
 * Проходит все блоки дня n: историю и задания верно, затем удачу (первая коробка) и подарок дня. Анонимному участнику
 * блоки награды отвечают `identity_required` (это не ошибка): день остаётся непройденным до входа по ссылке.
 */
export async function playDay(service: AdventService, advent: AdventConfig, participantId: string, n: number, now: Date): Promise<void> {
  const day = advent.days.find((candidate) => candidate.n === n)!;
  for (const [index, block] of day.blocks.entries()) {
    if (block.type === "story") await service.submitBlock(participantId, n, index, {}, now);
    if (block.type === "task") await service.submitBlock(participantId, n, index, correctPayload(block.task), now);
    if (block.type === "luck") await service.submitBlock(participantId, n, index, { choice: 0 }, now);
    if (block.type === "promo") await service.submitBlock(participantId, n, index, {}, now);
  }
}
