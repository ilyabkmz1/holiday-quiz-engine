/**
 * Заготовка пакета арендатора для `quiz:new`: структурно валидный пакет, где все тексты — «TODO: …».
 * Схема его пропускает, а `quiz:check` не выпустит, пока хотя бы один TODO остаётся.
 */

import { DEFAULT_WORLD_ID } from "@/config/pack";
import { loadWorld } from "@/worlds/registry";

const ZONE_ICONS = ["globe", "gift", "users", "chart", "check"];
const ZONE_COLORS = ["#62E0FF", "#FFCB5C", "#FF8A7A", "#A99BFF", "#6EE7A8"];
const SERVICE_ICONS = ["globe", "gift", "users", "chart", "check"];

export type TemplateOptions = {
  tenant: string;
  /** Число зон: от 3 до числа точек выбранного мира (на snow-globe их 5). */
  zones?: number;
  /** Мир из `worlds/`: от него берутся `spotId` зон и положение кнопок на карте режима cards. */
  worldId?: string;
};

export function buildTemplate({ tenant, zones = 3, worldId = DEFAULT_WORLD_ID }: TemplateOptions): Record<string, unknown> {
  const spots = loadWorld(worldId).spots.map((spot) => ({ id: spot.id, x: spot.card.x, y: spot.card.y }));
  const count = Math.min(Math.max(zones, 3), spots.length);
  const zoneIds = Array.from({ length: count }, (_, index) => `zone-${index + 1}`);
  const heroIds = ["hero-1", "hero-2", "hero-3"];

  const rooms = zoneIds.map((zoneId, index) => ({
    id: zoneId,
    title: `TODO: тема ${index + 1}`,
    eyebrow: `Зона ${index + 1} · TODO: тема`,
    description: `TODO: о чём эта зона и чему в ней научится игрок`,
    icon: ZONE_ICONS[index],
    ornament: "TODO: приз за зону",
    color: ZONE_COLORS[index],
    spotId: spots[index].id,
    map: { x: spots[index].x, y: spots[index].y },
    tasks: [
      {
        id: `${zoneId}-pick`,
        type: "pick",
        heroId: heroIds[index % heroIds.length],
        say: "TODO: ситуация и вопрос выбора",
        thanks: "TODO: похвала за верный выбор",
        oops: "TODO: мягкое объяснение ошибки",
        tip: "TODO: совет для запоминания",
        explanation: "TODO: почему верен именно этот вариант (по фактам брифа)",
        options: [
          { id: "alpha", title: "TODO: вариант 1", icon: "check" },
          { id: "beta", title: "TODO: вариант 2", icon: "msg" },
          { id: "gamma", title: "TODO: вариант 3", icon: "clock" }
        ],
        correctOptionId: "alpha"
      },
      {
        id: `${zoneId}-order`,
        type: "order",
        heroId: heroIds[(index + 1) % heroIds.length],
        say: "TODO: процесс, шаги которого нужно расставить по порядку",
        thanks: "TODO: похвала",
        oops: "TODO: объяснение ошибки",
        tip: "TODO: совет",
        explanation: "TODO: верный порядок и почему",
        // Порядок в items — как карточки показываются; он не совпадает с верным.
        items: [
          { id: "step-c", title: "TODO: шаг 3", icon: "check" },
          { id: "step-a", title: "TODO: шаг 1", icon: "pencil" },
          { id: "step-b", title: "TODO: шаг 2", icon: "clock" }
        ],
        correctOrder: ["step-a", "step-b", "step-c"]
      }
    ]
  }));

  const pool = Array.from({ length: 16 }, (_, index) => ({
    id: `rush-${index + 1}`,
    prompt: `TODO: короткая задача рывка ${index + 1}`,
    serviceId: zoneIds[index % zoneIds.length],
    security: index < 3
  }));

  return {
    tenant,
    hosts: [],
    worldId,
    campaign: {
      slug: `${tenant}-new-year`,
      mode: "cards",
      title: "TODO: название квиза",
      subtitle: "TODO: подзаголовок",
      intro: "TODO: завязка сюжета в 2–3 предложения",
      startsAt: "2026-12-20T00:00:00+03:00",
      claimEndsAt: "2026-12-31T23:59:59+03:00",
      verificationEndsAt: "2027-01-02T23:59:59+03:00",
      scene: { dateLabel: "TODO: дата на лендинге", rushClock: "23:59:30" },
      brand: {
        name: "TODO: название бренда",
        mark: "TODO",
        wordmark: "TODO",
        ogBackground: "/art/og-hero.jpg",
        font: "onest",
        colors: {
          bg: "#061024",
          panel: "#0b1836",
          ink: "#eef3ff",
          accent: "#1a62e8",
          accent2: "#62e0ff",
          highlight: "#ffcb5c",
          danger: "#ff8a7a",
          success: "#6ee7a8"
        },
        topNote: "Новогодний квиз",
        tagline: "TODO: подпись бренда под карточкой результата",
        ogCall: "TODO: призыв сыграть на картинке «Поделиться»",
        mailSubject: "TODO: тема письма с подтверждением"
      },
      story: {
        placeTitle: "TODO: название места действия",
        guideIntro: "TODO: первая реплика гида",
        landingAlt: "TODO: описание иллюстрации до старта",
        finaleAlt: "TODO: описание иллюстрации в финале",
        shareCardAlt: "TODO: описание иллюстрации на карточке",
        shareHeadline: "TODO: заголовок карточки результата",
        shareSubline: "TODO: подпись под счётом",
        shareLead: "TODO: приглашение на странице результата"
      },
      copy: {},
      legal: {
        operatorName: "TODO: юрлицо — оператор персональных данных",
        policyText: "[ТЕКСТ НА СОГЛАСОВАНИИ ЮРИСТА] Политика обработки персональных данных.",
        consentText: "[ТЕКСТ НА СОГЛАСОВАНИИ ЮРИСТА] Согласие на обработку персональных данных."
      },
      heroes: heroIds.map((id, index) => ({
        id,
        name: `TODO: имя ${index + 1}`,
        role: "TODO: роль",
        color: ["#FFD27A", "#62E0FF", "#FF9FB0"][index]
      })),
      prologue: {
        heroId: heroIds[0],
        lines: ["TODO: приветствие гида", "TODO: правила: в каждой зоне задания, ошибки не страшны"],
        mfa: { prompt: "TODO: подводка к переключателю", switchLabel: "TODO: подпись переключателя", done: "TODO: реплика после включения" }
      },
      rooms,
      rush: {
        intro: "TODO: вступление к финальному рывку",
        services: zoneIds.map((zoneId, index) => ({ id: zoneId, title: `TODO: тема ${index + 1}`, icon: SERVICE_ICONS[index], color: ZONE_COLORS[index] })),
        pool
      },
      rewardTiers: [
        { minScore: 0, title: "TODO: нижний уровень", description: "", giftLabel: "TODO: подарок" },
        { minPercent: 45, title: "TODO: средний уровень", description: "", giftLabel: "TODO: подарок" },
        { minPercent: 75, title: "TODO: высший уровень", description: "", giftLabel: "TODO: главный подарок" }
      ]
    }
  };
}
