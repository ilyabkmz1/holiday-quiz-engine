import type { AdventConfig } from "@/config/advent-schema";
import type { IdentityRepository } from "@/server/repositories/advent-repository";

/** Сколько суток после конца выдачи наград (`claimEndsAt`) хранятся email и согласия участников адвента. */
export const DEFAULT_ADVENT_PII_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `ADVENT_PII_RETENTION_DAYS`: целое число суток от 0; пусто — значение по умолчанию. */
export function parseRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_ADVENT_PII_RETENTION_DAYS;
  if (!/^\d{1,4}$/.test(raw.trim())) throw new Error("ADVENT_PII_RETENTION_DAYS должен быть целым числом суток от 0");
  return Number(raw.trim());
}

/** Момент, начиная с которого ПДн участников кампании стираются: `claimEndsAt` + срок хранения. */
export function adventPiiDueAt(advent: Pick<AdventConfig, "schedule">, retentionDays: number): Date {
  return new Date(new Date(advent.schedule.claimEndsAt).getTime() + retentionDays * DAY_MS);
}

export type AdventPiiCleanupResult = {
  deletedLoginTokens: number;
  anonymizedParticipants: number;
  /** Кампании, чей срок хранения истёк к `now`. */
  campaigns: string[];
};

/**
 * Очистка ПДн адвента: использованные и просроченные ссылки входа удаляются всегда, а у кампаний, чей срок хранения
 * после `claimEndsAt` истёк, стираются email и согласия участников (прогресс и награды остаются обезличенными).
 * Кампании, которых нет среди переданных пакетов, не трогаются.
 */
export async function cleanupAdventPii(
  repository: IdentityRepository,
  advents: ReadonlyArray<Pick<AdventConfig, "slug" | "schedule">>,
  now: Date,
  retentionDays: number
): Promise<AdventPiiCleanupResult> {
  const deletedLoginTokens = await repository.deleteStaleLoginTokens(now);
  const campaigns = advents.filter((advent) => now.getTime() >= adventPiiDueAt(advent, retentionDays).getTime()).map((advent) => advent.slug);
  let anonymizedParticipants = 0;
  for (const slug of campaigns) anonymizedParticipants += await repository.anonymizeCampaignParticipants(slug);
  return { deletedLoginTokens, anonymizedParticipants, campaigns };
}
