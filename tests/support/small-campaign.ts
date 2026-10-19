import { campaign } from "@tenants/demo-office/campaign";
import { campaignSchema, type CampaignConfig } from "@/config/schema";

/**
 * Урезанная кампания для проверки диапазонов: 3 зоны по 2 задания, 3 уровня (порог — доля от максимума),
 * сервисы рывка совпадают с зонами. Контент берётся из эталонного пакета demo-office, но id кампании свой.
 */
export function smallCampaign(slug = "small-test"): CampaignConfig {
  const draft = structuredClone(campaign);
  draft.slug = slug;
  draft.rooms = draft.rooms.slice(0, 3).map((room) => ({ ...room, tasks: room.tasks.slice(0, 2) }));
  const roomIds = new Set(draft.rooms.map((room) => room.id));
  draft.rush.services = draft.rush.services.filter((service) => roomIds.has(service.id));
  draft.rush.pool = draft.rush.pool.filter((item) => roomIds.has(item.serviceId));
  let copy = 0;
  while (draft.rush.pool.length < 16) {
    const source = draft.rush.pool[copy % draft.rush.pool.length];
    draft.rush.pool.push({ ...source, id: `${source.id}-copy${copy}` });
    copy += 1;
  }
  draft.rush.pool = draft.rush.pool.map((item, index) => ({ ...item, security: index < 3 }));
  draft.rewardTiers = [
    { minScore: 0, title: "Участник", description: "", giftLabel: "Спасибо" },
    { minPercent: 40, title: "Знаток", description: "", giftLabel: "Набор" },
    { minPercent: 75, title: "Мастер", description: "", giftLabel: "Главный приз" }
  ] as typeof draft.rewardTiers;
  return campaignSchema.parse(draft);
}
