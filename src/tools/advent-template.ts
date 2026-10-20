/**
 * Заготовка адвент-пакета для `quiz:new --experience advent`: структурно валидный пакет, где все тексты автора — «TODO: …».
 * Схема его пропускает, а `quiz:check` не выпустит, пока хотя бы один TODO остаётся. Значения по умолчанию (награды, догоняние,
 * серия, удача, напоминания, аудитория) берутся из профиля бизнеса через `applyProfile`; цели профиля пересчитываются
 * в `opened` под число дней через `resolveProfileGoals`.
 */
import { adventProfileSchema, applyProfile, PROFILE_IDS, type AdventProfile, type ProfileId } from "@/config/advent-profile";
import { ADVENT_LIMITS } from "@/config/advent-schema";
import { DEFAULT_WORLD_ID } from "@/config/pack";
import { asOfForDay } from "@/tools/advent-asof";
import { applyBrief, toIsoMoscow, type BriefFields } from "@/tools/brief";
import { rawProfiles } from "@profiles/index";

export type AdventTemplateOptions = {
  tenant: string;
  /** Число дней (5–31). */
  days: number;
  /** Профиль бизнеса или `custom` (нейтральные награды без кодов). */
  profile: ProfileId | "custom";
  /** Локальная дата первого дня, `YYYY-MM-DD`. */
  startDate?: string;
  worldId?: string;
};

export const ADVENT_PROFILE_CHOICES = [...PROFILE_IDS, "custom"] as const;

const HEROES = ["hero-1", "hero-2", "hero-3"];
const HERO_COLORS = ["#FFD27A", "#62E0FF", "#FF9FB0"];

/** Нейтральный профиль для `custom`: подарок без кода и участие в финале. */
const CUSTOM_PROFILE: AdventProfile = adventProfileSchema.parse({
  id: "retail",
  title: "Свой профиль",
  toneHints: ["Опишите тон и награды в брифе."],
  presentation: "storefront",
  facade: { templateId: "shop" },
  schedule: { timezone: "Europe/Moscow", unlockHour: 0, catchUp: { window: 1 }, rewardOnlyOnDay: false },
  streak: { endowedDay: true, freezes: 1, goals: [{ openedShare: 0.5, rewardId: "final-entry" }] },
  rewards: [
    { id: "daily-gift", kind: "gift", label: "Подарок дня", description: "Заберите подарок: порядок выдачи — в правилах.", redeem: "none" },
    { id: "final-entry", kind: "finalEntry", label: "Участие в финальном розыгрыше", description: "Главный приз заказчика.", redeem: "none" }
  ],
  reminders: { channel: "off" },
  audience: { kind: "customers", leaderboard: "off" }
});

export function loadProfile(id: ProfileId | "custom"): AdventProfile {
  if (id === "custom") return CUSTOM_PROFILE;
  return adventProfileSchema.parse(rawProfiles[id]);
}

function taskStub(n: number, heroId: string): Record<string, unknown> {
  return {
    id: `day-${n}-pick`,
    type: "pick",
    heroId,
    say: `TODO: вопрос дня ${n}`,
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
  };
}

/** Награда за закрытие дня: первая «дневная» награда профиля (`daily-*`). */
function dailyRewardId(profile: AdventProfile): string | undefined {
  return profile.rewards?.find((reward) => reward.id.startsWith("daily-") && reward.kind !== "finalEntry")?.id;
}

/** Пул удачи: утешительный приз без остатка (вес 7) и призы с остатком (вес 3). Без `luck` в профиле удачи нет. */
function luckPool(profile: AdventProfile): Array<{ rewardId: string; weight: number }> | null {
  const fallbackId = profile.luck?.fallbackRewardId;
  if (!profile.luck || !fallbackId) return null;
  const stocked = (profile.rewards ?? []).filter((reward) => reward.stock !== undefined && reward.id.startsWith("luck-")).map((reward) => ({ rewardId: reward.id, weight: 3 }));
  return [{ rewardId: fallbackId, weight: 7 }, ...stocked];
}

function dayStub(n: number, profile: AdventProfile, luckEvery: number): Record<string, unknown> {
  const heroId = HEROES[(n - 1) % HEROES.length];
  const pool = luckPool(profile);
  const luckDay = pool !== null && n % luckEvery === 0;
  const blocks: unknown[] = [{ type: "story", lines: [`TODO: реплика героя, факт или совет дня ${n}`] }];
  blocks.push(luckDay ? { type: "luck", choices: 3, pool } : { type: "task", task: taskStub(n, heroId) });
  const reward = dailyRewardId(profile);
  return {
    n,
    title: `TODO: название дня ${n}`,
    teaser: `TODO: анонс дня ${n} для закрытой двери и письма`,
    heroId,
    chapter: { lines: [`TODO: глава истории дня ${n}`, "TODO: чем глава подводит к следующему дню"] },
    blocks,
    // На дне удачи награда дня не выдаётся: приз даёт сама коробка.
    ...(reward && !luckDay ? { rewardId: reward } : {})
  };
}

export function buildAdventTemplate({ tenant, days, profile: profileId, startDate = "2026-12-20", worldId = DEFAULT_WORLD_ID }: AdventTemplateOptions): Record<string, unknown> {
  if (!Number.isInteger(days) || days < ADVENT_LIMITS.days.min || days > ADVENT_LIMITS.days.max) {
    throw new Error(`Число дней: от ${ADVENT_LIMITS.days.min} до ${ADVENT_LIMITS.days.max}`);
  }
  const profile = loadProfile(profileId);
  const unlockHour = profile.schedule?.unlockHour ?? 0;
  const timezone = profile.schedule?.timezone ?? "Europe/Moscow";
  const clock = { startDate, timezone };
  // Финал — ровно через сутки после открытия последнего дня: у игрока есть целый день, чтобы открыть последнюю дверь.
  const finaleAt = asOfForDay(clock, days + 1, unlockHour);
  const claimEndsAt = asOfForDay(clock, days + 14, 23).replace("T23:00:00", "T23:59:59");
  const teams = profile.audience?.leaderboard === "teams" ? [{ id: "team-1", title: "TODO: команда 1" }, { id: "team-2", title: "TODO: команда 2" }] : undefined;

  const draft: Record<string, unknown> = {
    slug: `${tenant}-advent`,
    title: "TODO: название адвента",
    subtitle: "TODO: подзаголовок",
    intro: "TODO: завязка сюжета в 2–3 предложения",
    brand: {
      name: "TODO: название бренда",
      mark: "TODO",
      wordmark: "TODO",
      ogBackground: "/art/og-hero.jpg",
      font: "onest",
      colors: { bg: "#061024", panel: "#0b1836", ink: "#eef3ff", accent: "#1a62e8", accent2: "#62e0ff", highlight: "#ffcb5c", danger: "#ff8a7a", success: "#6ee7a8" },
      topNote: "Адвент",
      tagline: "TODO: подпись бренда",
      ogCall: "TODO: призыв открыть двери адвента",
      mailSubject: "TODO: тема письма со ссылкой входа"
    },
    story: {
      placeTitle: "TODO: название места действия",
      guideIntro: "TODO: первая реплика гида",
      landingAlt: "TODO: описание иллюстрации до старта",
      finaleAlt: "TODO: описание иллюстрации в финале",
      shareCardAlt: "TODO: описание иллюстрации на карточке",
      shareHeadline: "TODO: заголовок карточки результата",
      shareSubline: "TODO: подпись под итогом",
      shareLead: "TODO: приглашение на странице результата"
    },
    copy: {},
    legal: {
      operatorName: "TODO: юрлицо — оператор персональных данных",
      policyText: "[ТЕКСТ НА СОГЛАСОВАНИИ ЮРИСТА] Политика обработки персональных данных.",
      consentText: "[ТЕКСТ НА СОГЛАСОВАНИИ ЮРИСТА] Согласие на обработку персональных данных."
    },
    // Хозяин у двери — первый герой; шаблон фасада приходит из профиля (`facade.templateId`), вывеска по умолчанию — название бренда.
    facade: { hostHeroId: HEROES[0] },
    heroes: HEROES.map((id, index) => ({ id, name: `TODO: имя ${index + 1}`, role: "TODO: роль", color: HERO_COLORS[index] })),
    schedule: { startDate, days, finaleAt, claimEndsAt },
    days: Array.from({ length: days }, (_, index) => dayStub(index + 1, profile, 4)),
    ...(teams ? { audience: { teams } } : {}),
    rules: { requiresPurchase: false }
  };

  const advent = applyProfile(profile, draft);
  // Награды профиля с погашением на сайте приходят без адреса: ставим маркер, чтобы quiz:check сразу показал, что заполнить.
  for (const reward of (advent as { rewards?: Array<{ redeem?: string; url?: string }> }).rewards ?? []) {
    if ((reward.redeem === "online" || reward.redeem === "both") && !reward.url) reward.url = "https://TODO.example/";
  }
  return { experience: "advent", tenant, hosts: [], worldId, profile: profileId, demo: false, advent };
}

// ——— Перенос брифа (раздел 12 `docs/brief-template.md`) ———

type AdventPackDraft = { hosts?: string[]; profile?: string; expectedParticipants?: number; advent: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** «да»/«нет» из брифа: `null` — значение не распознано. */
function yesNo(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  // \b в JS про ASCII и кириллицу не работает: граница слова задана через \p{L}.
  if (/^(да|yes|true|1)(?![\p{L}\p{N}])/u.test(normalized)) return true;
  if (/^(нет|no|false|0)(?![\p{L}\p{N}])/u.test(normalized)) return false;
  return null;
}

/** Профиль и число дней из брифа нужны до сборки заготовки: флаги CLI важнее. */
export function adventChoicesFromBrief(fields: BriefFields): { profile?: ProfileId | "custom"; days?: number; startDate?: string } {
  const profile = fields.adventProfile?.trim().toLowerCase();
  const days = Number(fields.adventDays);
  const start = fields.adventStart ? toIsoMoscow(fields.adventStart) : null;
  return {
    ...(profile && (ADVENT_PROFILE_CHOICES as readonly string[]).includes(profile) ? { profile: profile as ProfileId | "custom" } : {}),
    ...(Number.isInteger(days) && days >= ADVENT_LIMITS.days.min && days <= ADVENT_LIMITS.days.max ? { days } : {}),
    ...(start ? { startDate: start.slice(0, 10) } : {})
  };
}

/**
 * Переносит поля брифа в заготовку адвента (после `buildAdventTemplate`). Общие поля (бренд, юрлицо, домен, цвета, шрифт,
 * название) переносит `applyBrief`, остальное — здесь. Возвращает список перенесённых полей.
 */
export function applyAdventBrief(pack: AdventPackDraft, fields: BriefFields): string[] {
  const { advent } = pack;
  // Даты квиза и режим карточек адвенту не нужны: общую часть переносим без них.
  const common: BriefFields = { ...fields };
  for (const key of ["startsAt", "claimEndsAt", "verificationEndsAt", "mode"] as const) delete common[key];
  const shim = { hosts: pack.hosts, campaign: advent };
  const applied = applyBrief(shim, common);
  pack.hosts = shim.hosts;
  const set = (label: string, apply: () => void) => {
    apply();
    applied.push(label);
  };
  const { schedule, streak, reminders, audience } = advent;

  if (fields.adventUnlockHour !== undefined) {
    const hour = Number(fields.adventUnlockHour);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) set("schedule.unlockHour", () => { schedule.unlockHour = hour; });
  }
  if (fields.adventCatchUp) {
    const value = fields.adventCatchUp.trim().toLowerCase();
    const window = /(\d)/.exec(value)?.[1];
    if (/^нет/.test(value)) set("schedule.catchUp", () => { schedule.catchUp = "none"; });
    else if (/^все/.test(value)) set("schedule.catchUp", () => { schedule.catchUp = "all"; });
    else if (window && Number(window) >= 1 && Number(window) <= 7) set("schedule.catchUp", () => { schedule.catchUp = { window: Number(window) }; });
  }
  const onlyOnDay = yesNo(fields.adventRewardOnlyOnDay);
  if (onlyOnDay !== null) set("schedule.rewardOnlyOnDay", () => { schedule.rewardOnlyOnDay = onlyOnDay; });
  if (fields.adventPresentation === "calendar" || fields.adventPresentation === "world" || fields.adventPresentation === "storefront") set("presentation", () => { advent.presentation = fields.adventPresentation; });
  // Фасад «Витрины»: шаблон из брифа важнее шаблона профиля; вывеска — до 28 символов (длиннее схема не примет).
  const facadeId = fields.adventFacade?.trim().toLowerCase();
  if (facadeId && /^[a-z][a-z0-9-]{0,40}$/.test(facadeId)) set("facade.templateId", () => { advent.facade = { ...(advent.facade ?? {}), templateId: facadeId }; });
  if (fields.adventSign?.trim()) set("facade.signText", () => { advent.facade = { ...(advent.facade ?? {}), signText: fields.adventSign!.trim() }; });
  // Финал и конец выдачи: дата из брифа (финал — в час открытия дня, конец выдачи — в конце суток по Москве).
  const finale = fields.adventFinale ? toIsoMoscow(fields.adventFinale) : null;
  if (finale) {
    const at = `${finale.slice(0, 10)}T${String(schedule.unlockHour ?? 0).padStart(2, "0")}:00:00+03:00`;
    set("schedule.finaleAt", () => { schedule.finaleAt = at; });
  } else if (applied.includes("schedule.unlockHour")) {
    // Финала в брифе нет, а час открытия сменился: финал по-прежнему ровно через сутки после открытия последнего дня.
    schedule.finaleAt = asOfForDay({ startDate: schedule.startDate, timezone: schedule.timezone ?? "Europe/Moscow" }, schedule.days + 1, schedule.unlockHour);
  }
  const claimEnds = fields.adventClaimEnds ? toIsoMoscow(fields.adventClaimEnds, true) : null;
  if (claimEnds) set("schedule.claimEndsAt", () => { schedule.claimEndsAt = claimEnds; });
  if (fields.adventFreezes !== undefined) {
    const freezes = Number(fields.adventFreezes);
    if (Number.isInteger(freezes) && freezes >= 0 && freezes <= ADVENT_LIMITS.freezes.max) set("streak.freezes", () => { streak.freezes = freezes; });
  }
  const endowed = yesNo(fields.adventEndowedDay);
  if (endowed !== null) {
    set("streak.endowedDay", () => {
      streak.endowedDay = endowed;
      if (!endowed) delete streak.endowedRewardId;
    });
  }
  if (fields.adventLuck) {
    const value = fields.adventLuck.trim().toLowerCase();
    if (value === "boxes" || value === "wheel" || value === "scratch") {
      if (advent.luck) set("luck.skin", () => { advent.luck.skin = value; });
    } else if (/^нет/.test(value) && advent.luck) {
      set("luck (удаление: удачи не будет)", () => removeLuck(advent));
    }
  }
  const remindersOn = yesNo(fields.adventReminders);
  if (remindersOn !== null) set("reminders.channel", () => { reminders.channel = remindersOn ? "email" : "off"; });
  if (fields.adventReminderTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(fields.adventReminderTime.trim())) {
    set("reminders.sendAtLocal", () => { reminders.sendAtLocal = fields.adventReminderTime!.trim(); });
  }
  const audienceKind = fields.adventAudience?.trim().toLowerCase();
  if (audienceKind === "customers" || audienceKind === "employees") set("audience.kind", () => { audience.kind = audienceKind; });
  const board = fields.adventLeaderboard?.trim().toLowerCase();
  if (board === "off" || board === "individual" || board === "teams") {
    set("audience.leaderboard", () => {
      audience.leaderboard = board;
      if (board !== "teams") delete audience.teams;
      else audience.teams ??= [{ id: "team-1", title: "TODO: команда 1" }, { id: "team-2", title: "TODO: команда 2" }];
    });
  }
  if (fields.adventTeams && (audience.leaderboard === "teams" || board === "teams")) {
    const titles = fields.adventTeams.split(/[,;]/).map((title) => title.trim()).filter(Boolean);
    if (titles.length >= 1) set("audience.teams", () => { audience.teams = titles.map((title, index) => ({ id: `team-${index + 1}`, title })); });
  }
  const participants = Number(fields.adventParticipants?.replace(/\s/g, ""));
  if (Number.isInteger(participants) && participants >= 1) set("expectedParticipants", () => { pack.expectedParticipants = participants; });
  const purchase = yesNo(fields.adventRequiresPurchase);
  if (purchase !== null) set("rules.requiresPurchase", () => { advent.rules = { ...advent.rules, requiresPurchase: purchase }; });
  return applied;
}

/** Убирает удачу из заготовки: блоки удачи заменяются заданиями, секция `luck` удаляется. */
function removeLuck(advent: Record<string, any>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  delete advent.luck;
  const reward = (advent.rewards as Array<{ id: string }>).find((item) => item.id.startsWith("daily-"))?.id;
  for (const day of advent.days as Array<Record<string, any>>) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!day.blocks.some((block: { type: string }) => block.type === "luck")) continue;
    day.blocks = day.blocks.map((block: { type: string }) => (block.type === "luck" ? { type: "task", task: taskStub(day.n, day.heroId) } : block));
    if (reward) day.rewardId = reward;
  }
}
