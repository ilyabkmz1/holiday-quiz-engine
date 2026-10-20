import { DEFAULT_WORLD_ID } from "@/config/pack";
import type { CampaignConfig, Task } from "@/config/schema";
import { RUSH } from "@/domain/rush";
import { SCORING } from "@/domain/scoring";
import { seededShuffle } from "@/server/shuffle";
import type { AdventConfig } from "@/config/advent-schema";
import { loadFacade } from "@/facades/registry";
import type { PublicAdvent, PublicFacade } from "@/types/advent";
import type { PublicCampaign, PublicTask } from "@/types/api";

/** Кампания для клиента: без текстов разбора заданий и без пула рывка. */
/** `worldId` — мир пакета (`TenantPack.worldId`); по умолчанию мир по умолчанию схемы пакета. */
export function publicCampaign(campaign: CampaignConfig, worldId: string = DEFAULT_WORLD_ID): PublicCampaign {
  return {
    slug: campaign.slug,
    worldId,
    mode: campaign.mode,
    title: campaign.title,
    subtitle: campaign.subtitle,
    intro: campaign.intro,
    scene: campaign.scene,
    heroes: campaign.heroes,
    prologue: campaign.prologue,
    rooms: campaign.rooms.map((room) => ({
      id: room.id,
      title: room.title,
      eyebrow: room.eyebrow,
      description: room.description,
      icon: room.icon,
      ornament: room.ornament,
      color: room.color,
      map: room.map,
      hostId: room.hostId ?? room.tasks[0].heroId,
      spotId: room.spotId ?? room.id,
      taskIds: room.tasks.map((task) => task.id)
    })),
    rush: {
      intro: campaign.rush.intro,
      services: campaign.rush.services,
      durationSeconds: RUSH.durationMs / 1000,
      penaltySeconds: RUSH.penaltyMs / 1000,
      pointsPerHit: SCORING.rushHitPoints
    },
    rules: {
      fusesPerRoom: SCORING.fusesPerRoom,
      noFailBonus: SCORING.noFailBonus,
      speedWindowSeconds: SCORING.speedWindowSeconds
    },
    rewardTiers: campaign.rewardTiers.map(({ minScore, title, description, giftLabel }) => ({ minScore, title, description, giftLabel })),
    legal: { consentText: campaign.legal.consentText },
    brand: {
      name: campaign.brand.name,
      mark: campaign.brand.mark,
      wordmark: campaign.brand.wordmark,
      ...(campaign.brand.logo ? { logo: campaign.brand.logo } : {}),
      tagline: campaign.brand.tagline,
      topNote: campaign.brand.topNote
    },
    story: campaign.story,
    copy: campaign.copy
  };
}

/**
 * Представление задания для игрока. Варианты (карточки, письма, переключатели, шаги `order`)
 * перемешиваются детерминированно по зерну «сессия + задание»: порядок в конфигурации не выдаёт
 * ответ, а восстановление игры и повторный запрос показывают тот же порядок.
 *
 * Для `order` это порядок карточек в «руке»: игрок расставляет их с пустых слотов, а исключать верный порядок нельзя, потому что отсутствие совпадения само стало бы подсказкой. Поля берутся явным списком: новые поля конфигурации
 * (в частности признаки правильности) не попадут клиенту, пока их здесь не перечислят.
 */
export function publicTask(roomId: string, task: Task, sessionId: string): PublicTask {
  const seed = `${sessionId}:${task.id}`;
  const base = { id: task.id, roomId, heroId: task.heroId, say: task.say };
  const card = (item: { id: string; title: string; icon: string }) => ({
    id: item.id,
    title: item.title,
    icon: item.icon
  });
  switch (task.type) {
    case "pick":
      return { ...base, type: "pick", options: seededShuffle(task.options, seed).map(card) };
    case "build":
      return { ...base, type: "build", slots: task.slots, options: seededShuffle(task.options, seed).map(card) };
    case "phish":
      return {
        ...base,
        type: "phish",
        letters: seededShuffle(task.letters, seed).map((letter) => ({
          id: letter.id,
          sender: letter.sender,
          address: letter.address,
          subject: letter.subject,
          mark: letter.mark,
          attachment: letter.attachment
        }))
      };
    case "access":
      return { ...base, type: "access", switches: seededShuffle(task.switches, seed).map(card) };
    case "order":
      return { ...base, type: "order", items: seededShuffle(task.items, seed).map(card) };
  }
}

/** Фасад «Витрины»: шаблон проверен схемой при загрузке; хозяин по умолчанию — первый герой пакета, вывеска — название бренда. */
function publicFacade(advent: AdventConfig): PublicFacade {
  const choice = advent.facade!;
  return {
    template: loadFacade(choice.templateId),
    hostHeroId: choice.hostHeroId ?? advent.heroes[0].id,
    signText: choice.signText ?? advent.brand.name
  };
}

/** Адвент для клиента: явный список полей (задания, награды и пулы удачи уходят только через состояние участника). */
export function publicAdvent(advent: AdventConfig, tenant: string, worldId: string = DEFAULT_WORLD_ID): PublicAdvent {
  return {
    slug: advent.slug,
    tenant,
    worldId,
    title: advent.title,
    subtitle: advent.subtitle,
    intro: advent.intro,
    presentation: advent.presentation,
    facade: advent.facade ? publicFacade(advent) : null,
    heroes: advent.heroes.map(({ id, name, role, color }) => ({ id, name, role, color })),
    brand: {
      name: advent.brand.name,
      mark: advent.brand.mark,
      wordmark: advent.brand.wordmark,
      ...(advent.brand.logo ? { logo: advent.brand.logo } : {}),
      tagline: advent.brand.tagline,
      topNote: advent.brand.topNote
    },
    story: { placeTitle: advent.story.placeTitle, guideIntro: advent.story.guideIntro },
    copy: advent.copy,
    legal: { operatorName: advent.legal.operatorName, consentText: advent.legal.consentText },
    schedule: {
      timezone: advent.schedule.timezone,
      days: advent.schedule.days,
      startDate: advent.schedule.startDate,
      finaleAt: advent.schedule.finaleAt,
      claimEndsAt: advent.schedule.claimEndsAt
    },
    luckSkin: advent.luck?.skin ?? null
  };
}
