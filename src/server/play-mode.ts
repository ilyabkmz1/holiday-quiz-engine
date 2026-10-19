import type { CampaignMode } from "@/types/api";

/**
 * Режим игры на главной: по умолчанию тот, что задан в кампании (`campaign.mode`). Параметр
 * `?mode=cards|quest` переключает редакцию для показа, отладки и E2E карточного режима;
 * сессия, ответы и очки при этом общие.
 */
export function resolveMode(configured: CampaignMode, requested: string | string[] | undefined): CampaignMode {
  const value = Array.isArray(requested) ? requested[0] : requested;
  return value === "cards" || value === "quest" ? value : configured;
}
