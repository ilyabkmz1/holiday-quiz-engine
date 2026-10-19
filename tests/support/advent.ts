import { adventSchema, type AdventConfig } from "@/config/advent-schema";
import { correctPayload } from "@/domain/solve";
import { InMemoryAdventRepository } from "@/server/repositories/in-memory-advent-repository";
import { AdventService } from "@/server/services/advent-service";

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

export function newAdventService(advent: AdventConfig = adventConfig()) {
  const repository = new InMemoryAdventRepository();
  return { repository, advent, service: new AdventService(repository, advent) };
}

/** Проходит все блоки истории и заданий дня n верно. Блоки удачи и подарка пропускаются. */
export async function playDay(service: AdventService, advent: AdventConfig, participantId: string, n: number, now: Date): Promise<void> {
  const day = advent.days.find((candidate) => candidate.n === n)!;
  for (const [index, block] of day.blocks.entries()) {
    if (block.type === "story") await service.submitBlock(participantId, n, index, {}, now);
    if (block.type === "task") await service.submitBlock(participantId, n, index, correctPayload(block.task), now);
  }
}
