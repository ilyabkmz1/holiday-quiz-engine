import { cache } from "react";

import type { CampaignConfig } from "@/config/schema";
import type { PrismaClient } from "@/generated/prisma/client";

/** Публичный итог игры: ровно то, что можно показать любому, у кого есть ссылка. Никаких данных заявки. */
export type ShareSummary = {
  score: number;
  tierTitle: string;
  campaignTitle: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id сессии в каноническом виде (нижний регистр) или null, если это не UUID. */
export function normalizeShareSessionId(sessionId: string): string | null {
  return UUID_PATTERN.test(sessionId) ? sessionId.toLowerCase() : null;
}

/**
 * Итог завершённой сессии кампании или null (страница отдаёт 404): неверный формат id, чужая кампания,
 * незавершённая игра. Из базы читаются только счёт и название уровня.
 */
export async function loadShareSummary(
  prisma: PrismaClient,
  campaign: CampaignConfig,
  sessionId: string
): Promise<ShareSummary | null> {
  if (!UUID_PATTERN.test(sessionId)) return null;
  const session = await prisma.gameSession.findFirst({
    where: { id: sessionId.toLowerCase(), campaignSlug: campaign.slug, status: "completed" },
    select: { score: true, rewardTierTitle: true }
  });
  if (!session || session.score === null || !session.rewardTierTitle) return null;
  return { score: session.score, tierTitle: session.rewardTierTitle, campaignTitle: campaign.title };
}

/** Одна выборка на запрос: и generateMetadata, и сама страница читают итог. */
export const loadShareSummaryCached = cache(loadShareSummary);
