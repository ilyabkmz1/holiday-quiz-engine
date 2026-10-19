import { z } from "zod";

import { brandSchema, copySchema, storySchema } from "@/config/brand";
import { ICON_PATHS } from "@/config/icon-paths";
import { contrastIssues } from "@/config/theme";
import { maxScore } from "@/domain/scoring";

const id = z.string().min(1).max(64);

/** Карточка-инструмент, письмо-вариант или переключатель: название и имя иконки (UI сопоставляет имя с картинкой). */
const cardSchema = z.object({
  id,
  title: z.string().min(1),
  icon: z.string().min(1)
});

/** Подписи сцены, которые раньше были зашиты в разметку: дата на лендинге и часы на заставке рывка. */
const sceneSchema = z.object({
  dateLabel: z.string().min(1),
  rushClock: z.string().min(1)
});

/**
 * Идентификаторы вариантов видит игрок до ответа, поэтому в них нельзя оставлять намёк на верность.
 * Проверка грубая (по словам-маркерам), но ловит типичные случайные утечки вроде `fake` или `correct`.
 */
export const REVEALING_ID_PATTERN = /correct|right|wrong|fake|genuine|trap|phish|spam|bad|good|true|false/i;

const heroSchema = z.object({
  id,
  name: z.string().min(1),
  role: z.string().min(1),
  // Цвет плейсхолдер-аватара, пока нет иллюстраций.
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
});

const taskBase = {
  id,
  heroId: id,
  say: z.string().min(1),
  thanks: z.string().min(1),
  oops: z.string().min(1),
  tip: z.string().min(1),
  explanation: z.string().min(1)
};

function hasUniqueIds(items: Array<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

export function issue(context: z.RefinementCtx, message: string, path: Array<string | number>): void {
  context.addIssue({ code: "custom", message, path });
}

function checkOptionIds(
  context: z.RefinementCtx,
  items: Array<{ id: string }>,
  field: string
): Set<string> {
  if (!hasUniqueIds(items)) {
    issue(context, `Duplicate ids in ${field}`, [field]);
  }
  return new Set(items.map((item) => item.id));
}

function checkSubset(
  context: z.RefinementCtx,
  known: Set<string>,
  chosen: string[],
  field: string
): void {
  if (new Set(chosen).size !== chosen.length) {
    issue(context, `Duplicate ids in ${field}`, [field]);
  }
  for (const value of chosen) {
    if (!known.has(value)) {
      issue(context, `Unknown id in ${field}: ${value}`, [field]);
    }
  }
}

export const pickTaskSchema = z
  .object({
    ...taskBase,
    type: z.literal("pick"),
    options: z.array(cardSchema).min(3).max(4),
    correctOptionId: id
  })
  .superRefine((task, context) => {
    const known = checkOptionIds(context, task.options, "options");
    checkSubset(context, known, [task.correctOptionId], "correctOptionId");
  });

export const buildTaskSchema = z
  .object({
    ...taskBase,
    type: z.literal("build"),
    slots: z.number().int().min(2).max(4),
    options: z.array(cardSchema).min(3).max(6),
    correctOptionIds: z.array(id).min(2).max(4)
  })
  .superRefine((task, context) => {
    const known = checkOptionIds(context, task.options, "options");
    checkSubset(context, known, task.correctOptionIds, "correctOptionIds");
    if (task.correctOptionIds.length !== task.slots) {
      issue(context, "Number of correct cards must equal the number of slots", ["correctOptionIds"]);
    }
    if (task.options.length <= task.slots) {
      issue(context, "Build needs at least one trap card beyond the slots", ["options"]);
    }
  });

const letterSchema = z.object({
  id,
  sender: z.string().min(1),
  address: z.string().min(1),
  subject: z.string().min(1),
  // Отметка почты: «проверен» (бизнес), «госструктура» или без отметки.
  mark: z.enum(["none", "verified", "gov"]),
  attachment: z.string().min(1).nullable()
});

export const phishTaskSchema = z
  .object({
    ...taskBase,
    type: z.literal("phish"),
    letters: z.array(letterSchema).min(3).max(5),
    fakeLetterId: id
  })
  .superRefine((task, context) => {
    const known = checkOptionIds(context, task.letters, "letters");
    checkSubset(context, known, [task.fakeLetterId], "fakeLetterId");
  });

export const accessTaskSchema = z
  .object({
    ...taskBase,
    type: z.literal("access"),
    switches: z.array(cardSchema).min(4).max(6),
    correctEnabledIds: z.array(id).min(1)
  })
  .superRefine((task, context) => {
    const known = checkOptionIds(context, task.switches, "switches");
    checkSubset(context, known, task.correctEnabledIds, "correctEnabledIds");
    if (task.correctEnabledIds.length >= task.switches.length) {
      issue(context, "Access needs at least one trap switch that stays off", ["correctEnabledIds"]);
    }
  });

export const orderTaskSchema = z
  .object({
    ...taskBase,
    type: z.literal("order"),
    // Порядок в `items` — как карточки показываются игроку; он не должен совпадать с верным.
    items: z.array(cardSchema).min(3).max(4),
    correctOrder: z.array(id).min(3).max(4)
  })
  .superRefine((task, context) => {
    const known = checkOptionIds(context, task.items, "items");
    checkSubset(context, known, task.correctOrder, "correctOrder");
    if (task.correctOrder.length !== task.items.length) {
      issue(context, "correctOrder must be a permutation of items", ["correctOrder"]);
    } else if (task.items.every((item, index) => item.id === task.correctOrder[index])) {
      issue(context, "Items must be presented in a scrambled order", ["items"]);
    }
  });

/** Допустимые количества: движок работает с любым числом в этих диапазонах, а не только с 5 × 3 из первой кампании. */
export const LIMITS = {
  heroes: { min: 1, max: 8 },
  rooms: { min: 3, max: 6 },
  tasksPerRoom: { min: 2, max: 4 },
  rewardTiers: { min: 2, max: 5 },
  rushServices: { min: 3, max: 6 }
} as const;

export const taskSchema = z.discriminatedUnion("type", [
  pickTaskSchema,
  buildTaskSchema,
  phishTaskSchema,
  accessTaskSchema,
  orderTaskSchema
]);

const roomSchema = z.object({
  id,
  title: z.string().min(1),
  eyebrow: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().min(1),
  // Игрушка на ёлку за пройденную комнату.
  ornament: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  // Положение кнопки комнаты на карте офиса, проценты от размера иллюстрации.
  map: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }),
  // Точка мира (`worlds/<id>/world.json`, spots[].id), к которой привязана зона; по умолчанию совпадает с id зоны.
  spotId: id.optional(),
  // Герой-«хозяин» зоны до выдачи первой заявки (дальше показывается герой текущего задания); по умолчанию — герой первого задания.
  hostId: id.optional(),
  tasks: z.array(taskSchema).min(LIMITS.tasksPerRoom.min).max(LIMITS.tasksPerRoom.max)
});

const prologueSchema = z.object({
  heroId: id,
  lines: z.array(z.string().min(1)).min(1),
  mfa: z.object({
    prompt: z.string().min(1),
    switchLabel: z.string().min(1),
    done: z.string().min(1)
  })
});

const rushServiceSchema = z.object({
  id,
  title: z.string().min(1),
  icon: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
});

const rushItemSchema = z.object({
  id,
  prompt: z.string().min(1),
  serviceId: id,
  // Заявка про безопасность: в пуле их должно быть несколько.
  security: z.boolean()
});

const rushSchema = z.object({
  intro: z.string().min(1),
  services: z.array(rushServiceSchema).min(LIMITS.rushServices.min).max(LIMITS.rushServices.max),
  pool: z.array(rushItemSchema).min(16)
});

/**
 * Порог уровня: абсолютные очки (`minScore`) или доля от максимума кампании (`minPercent`, 0–100).
 * Нужно одно из двух; после разбора у каждого уровня остаётся `minScore` (с `minPercent`, если он был задан),
 * поэтому уже разобранную кампанию можно разбирать повторно: оба поля допустимы, если они согласованы.
 */
const rewardTierInputSchema = z.object({
  minScore: z.number().int().min(0).optional(),
  minPercent: z.number().min(0).max(100).optional(),
  title: z.string().min(1),
  description: z.string(),
  giftLabel: z.string().min(1)
}).refine((tier) => tier.minScore !== undefined || tier.minPercent !== undefined, {
  message: "Reward tier needs minScore or minPercent"
});

export type RewardTierConfig = {
  minScore: number;
  minPercent?: number;
  title: string;
  description: string;
  giftLabel: string;
};

/** Подача игры: `cards` — карта и полноэкранные комнаты, `quest` — мир-иллюстрация, по которому бегает персонаж. */
export const campaignModeSchema = z.enum(["cards", "quest"]);

/** Юридические тексты кампании; сами тексты и маркер «на согласовании» — в `src/config/legal.ts` (модуль без zod для клиента). */
export const legalSchema = z.object({
  operatorName: z.string().trim().min(1),
  policyText: z.string().trim().min(1),
  consentText: z.string().trim().min(1)
});

/**
 * Общая часть кампании любого вида (квиз, адвент): идентификатор, тексты, бренд, метафора, юридические тексты и герои.
 * Квиз добавляет к ней зоны, рывок и уровни наград, адвент — расписание, дни и награды (`advent-schema.ts`).
 */
export const campaignCoreSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  intro: z.string().min(1),
  brand: brandSchema,
  story: storySchema,
  copy: copySchema.prefault({}),
  legal: legalSchema,
  heroes: z.array(heroSchema).min(LIMITS.heroes.min).max(LIMITS.heroes.max)
});

const core = campaignCoreSchema.shape;

// Поля перечислены в прежнем порядке, а не через `extend`: от порядка ключей зависят порядок ошибок схемы
// (их печатает `quiz:check`) и порядок ключей в разобранной кампании.
const campaignBaseSchema = z.object({
  slug: core.slug,
  mode: campaignModeSchema.default("quest"),
  title: core.title,
  subtitle: core.subtitle,
  intro: core.intro,
  startsAt: z.iso.datetime({ offset: true }),
  claimEndsAt: z.iso.datetime({ offset: true }),
  verificationEndsAt: z.iso.datetime({ offset: true }),
  scene: sceneSchema,
  brand: core.brand,
  story: core.story,
  copy: core.copy,
  legal: core.legal,
  heroes: core.heroes,
  prologue: prologueSchema,
  rooms: z.array(roomSchema).min(LIMITS.rooms.min).max(LIMITS.rooms.max),
  rush: rushSchema,
  rewardTiers: z.array(rewardTierInputSchema).min(LIMITS.rewardTiers.min).max(LIMITS.rewardTiers.max)
});

/** Пороги уровней в очках: проценты переводятся от максимума, посчитанного по составу кампании. */
function resolveTiers(campaign: z.infer<typeof campaignBaseSchema>): RewardTierConfig[] {
  const max = maxScore(campaign.rooms.map((room) => room.tasks.length));
  return campaign.rewardTiers.map((tier) => ({
    ...tier,
    minScore: tier.minScore ?? Math.round(((tier.minPercent ?? 0) / 100) * max)
  }));
}

function tiersAreConsistent(campaign: z.infer<typeof campaignBaseSchema>): boolean {
  const max = maxScore(campaign.rooms.map((room) => room.tasks.length));
  return campaign.rewardTiers.every(
    (tier) => tier.minScore === undefined || tier.minPercent === undefined || tier.minScore === Math.round((tier.minPercent / 100) * max)
  );
}

/** Варианты ответа задания, видимые игроку до ответа: письма, переключатели, карточки. */
export function taskVariants(task: Task): Array<{ id: string }> {
  return task.type === "phish" ? task.letters : task.type === "access" ? task.switches : task.type === "order" ? task.items : task.options;
}

/** Проверки общей части: герои с уникальными id; возвращает множество id героев для остальных проверок. */
export function checkCoreHeroes(context: z.RefinementCtx, heroes: Array<{ id: string }>): Set<string> {
  const heroIds = new Set(heroes.map((hero) => hero.id));
  if (heroIds.size !== heroes.length) {
    issue(context, "Hero ids must be unique", ["heroes"]);
  }
  return heroIds;
}

/** Контраст палитры бренда: одинаковая проверка для квиза и адвента. */
export function checkBrandContrast(context: z.RefinementCtx, brand: z.infer<typeof brandSchema>): void {
  for (const problem of contrastIssues(brand.colors, brand.derived)) {
    issue(context, `Низкий контраст в палитре бренда: ${problem}`, ["brand", "colors"]);
  }
}

/** Неизвестные имена иконок: общий список для проверки заданий. */
export function isKnownIcon(name: string): boolean {
  return name !== "fallback" && name in ICON_PATHS;
}

export const campaignSchema = campaignBaseSchema.superRefine((campaign, context) => {
  const heroIds = checkCoreHeroes(context, campaign.heroes);
  if (!heroIds.has(campaign.prologue.heroId)) {
    issue(context, "Unknown prologue hero", ["prologue", "heroId"]);
  }

  const roomIds = campaign.rooms.map((room) => room.id);
  if (new Set(roomIds).size !== roomIds.length) {
    issue(context, "Room ids must be unique", ["rooms"]);
  }

  const tasks = campaign.rooms.flatMap((room) => room.tasks);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    issue(context, "Task ids must be unique", ["rooms"]);
  }
  for (const task of tasks) {
    for (const variant of taskVariants(task)) {
      if (REVEALING_ID_PATTERN.test(variant.id)) {
        issue(context, `Variant id in task ${task.id} hints at the answer: ${variant.id}`, ["rooms"]);
      }
    }
  }
  for (const room of campaign.rooms) {
    if (room.hostId && !heroIds.has(room.hostId)) issue(context, `Unknown host hero in room ${room.id}: ${room.hostId}`, ["rooms"]);
  }
  tasks.forEach((task) => {
    if (!heroIds.has(task.heroId)) {
      issue(context, `Unknown hero in task ${task.id}: ${task.heroId}`, ["rooms"]);
    }
  });

  const serviceIds = new Set(campaign.rush.services.map((service) => service.id));
  if (serviceIds.size !== campaign.rush.services.length) {
    issue(context, "Rush service ids must be unique", ["rush", "services"]);
  }
  if (new Set(campaign.rush.pool.map((item) => item.id)).size !== campaign.rush.pool.length) {
    issue(context, "Rush item ids must be unique", ["rush", "pool"]);
  }
  for (const item of campaign.rush.pool) {
    if (!serviceIds.has(item.serviceId)) {
      issue(context, `Unknown service in rush item ${item.id}`, ["rush", "pool"]);
    }
  }
  const securityItems = campaign.rush.pool.filter((item) => item.security).length;
  if (securityItems < 3 || securityItems > 4) {
    issue(context, "Rush pool must contain 3-4 security items", ["rush", "pool"]);
  }
  // Кнопки рывка — это зоны кампании: id сервисов совпадают с id зон (раньше связь была скрытой).
  const roomIdSet = new Set(roomIds);
  if (serviceIds.size !== roomIdSet.size || [...serviceIds].some((serviceId) => !roomIdSet.has(serviceId))) {
    issue(context, "Rush service ids must match room ids", ["rush", "services"]);
  }
  // Каждый сервис должен быть верным ответом хотя бы на одну заявку, иначе кнопка бессмысленна.
  for (const serviceId of serviceIds) {
    if (!campaign.rush.pool.some((item) => item.serviceId === serviceId)) {
      issue(context, `Rush service ${serviceId} is never the right answer`, ["rush", "pool"]);
    }
  }

  checkBrandContrast(context, campaign.brand);

  const iconNames: Array<{ name: string; where: string }> = [];
  for (const room of campaign.rooms) {
    iconNames.push({ name: room.icon, where: `room ${room.id}` });
    for (const task of room.tasks) {
      if (task.type === "phish") continue;
      const variants = task.type === "access" ? task.switches : task.type === "order" ? task.items : task.options;
      for (const variant of variants) iconNames.push({ name: variant.icon, where: `task ${task.id}` });
    }
  }
  for (const service of campaign.rush.services) iconNames.push({ name: service.icon, where: `rush service ${service.id}` });
  for (const { name, where } of iconNames) {
    if (!isKnownIcon(name)) issue(context, `Unknown icon "${name}" in ${where}`, ["rooms"]);
  }

  if (!tiersAreConsistent(campaign)) {
    issue(context, "Reward tier has both minScore and minPercent, and they disagree", ["rewardTiers"]);
  }
  const tierScores = resolveTiers(campaign).map((tier) => tier.minScore);
  if (tierScores[0] !== 0 || tierScores.some((score, index) => index > 0 && score <= tierScores[index - 1])) {
    issue(context, "Reward tiers must start at zero and be strictly increasing", ["rewardTiers"]);
  }

  if (!(new Date(campaign.startsAt) < new Date(campaign.claimEndsAt)) ||
      !(new Date(campaign.claimEndsAt) < new Date(campaign.verificationEndsAt))) {
    context.addIssue({ code: "custom", message: "Campaign dates are out of order" });
  }
}).transform((campaign) => ({ ...campaign, rewardTiers: resolveTiers(campaign) }));

/** Общая часть кампании любого вида (квиз, адвент). */
export type CampaignCore = z.infer<typeof campaignCoreSchema>;
export type CampaignMode = z.infer<typeof campaignModeSchema>;
export type CampaignConfig = z.infer<typeof campaignSchema>;
export type Hero = z.infer<typeof heroSchema>;
export type Card = z.infer<typeof cardSchema>;
export type Letter = z.infer<typeof letterSchema>;
export type Task = z.infer<typeof taskSchema>;
export type PickTask = z.infer<typeof pickTaskSchema>;
export type BuildTask = z.infer<typeof buildTaskSchema>;
export type PhishTask = z.infer<typeof phishTaskSchema>;
export type AccessTask = z.infer<typeof accessTaskSchema>;
export type OrderTask = z.infer<typeof orderTaskSchema>;
export type TaskType = Task["type"];
export type Room = z.infer<typeof roomSchema>;
export type RushItem = z.infer<typeof rushItemSchema>;
export type RushService = z.infer<typeof rushServiceSchema>;
