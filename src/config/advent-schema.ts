import { z } from "zod";

import { copySchema } from "@/config/brand";
import {
  REVEALING_ID_PATTERN,
  campaignCoreSchema,
  checkBrandContrast,
  checkCoreHeroes,
  isKnownIcon,
  issue,
  taskSchema,
  taskVariants
} from "@/config/schema";
import { dayUnlockAt } from "@/domain/advent/calendar";

const id = z.string().min(1).max(64);

/**
 * Слова, по которым в id награды из пула удачи видно её ценность («крупный», «утешительный»).
 * Дополняет `REVEALING_ID_PATTERN` (он про правильность ответа): id приза нейтральные, например `luck-a`, `luck-b`.
 */
export const LUCK_VALUE_ID_PATTERN = /big|small|grand|jackpot|mega|rare|consol|cheap|premium|major|minor/i;

/** Дни адвента: от недельного челленджа до полного календаря. */
export const ADVENT_LIMITS = {
  days: { min: 5, max: 31 },
  dayBlocks: { min: 1, max: 3 },
  chapterLines: { min: 1, max: 4 },
  luckChoices: { min: 3, max: 6 },
  freezes: { max: 3 },
  catchUpWindow: { min: 1, max: 7 }
} as const;

export const presentationSchema = z.enum(["world", "calendar"]);

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

export const timezoneSchema = z.string().refine(isIanaTimezone, "Часовой пояс должен быть в формате IANA, например Europe/Moscow");
export const startDateSchema = z.string().refine(isRealDate, "Дата начала: существующая дата в формате YYYY-MM-DD");
export const catchUpSchema = z.union([
  z.literal("none"),
  z.literal("all"),
  z.strictObject({ window: z.number().int().min(ADVENT_LIMITS.catchUpWindow.min).max(ADVENT_LIMITS.catchUpWindow.max) })
]);

export const scheduleSchema = z.object({
  timezone: timezoneSchema.default("Europe/Moscow"),
  /** Локальная дата первого дня. */
  startDate: startDateSchema,
  days: z.number().int().min(ADVENT_LIMITS.days.min).max(ADVENT_LIMITS.days.max),
  /** День n открывается в `startDate + n − 1`, в `unlockHour:00` по `timezone`. */
  unlockHour: z.number().int().min(0).max(23).default(0),
  /** Финал: главная награда и итоги рейтинга; двери после него не открываются. */
  finaleAt: z.iso.datetime({ offset: true }),
  /** После этого момента коды не выдаются. */
  claimEndsAt: z.iso.datetime({ offset: true }),
  catchUp: catchUpSchema.default("none"),
  /** Догнал день — получил историю, но не приз дня. */
  rewardOnlyOnDay: z.boolean().default(false)
});

export const rewardKindSchema = z.enum(["promo", "gift", "points", "finalEntry"]);
export const redeemSchema = z.enum(["online", "cashier", "both", "none"]);

const codesSchema = z.union([
  z.strictObject({ static: z.string().trim().min(1) }),
  z.strictObject({ list: z.string().regex(/^codes\/[A-Za-z0-9_-]+\.csv$/, "Список кодов: codes/<id>.csv") }),
  z.strictObject({
    generated: z.strictObject({
      prefix: z.string().regex(/^[A-Z0-9-]{0,12}$/, "Префикс кода: заглавные латинские буквы, цифры и дефис, до 12 символов"),
      length: z.number().int().min(4).max(16)
    })
  })
]);

export const rewardSchema = z.object({
  id,
  kind: rewardKindSchema,
  label: z.string().min(1),
  description: z.string().default(""),
  valueRub: z.number().int().min(0).optional(),
  codes: codesSchema.optional(),
  /** Срок действия с момента выдачи, сутки. */
  validDays: z.number().int().min(1).max(30).optional(),
  /** Остаток для розыгрыша удачи; без поля приз не ограничен. */
  stock: z.number().int().min(0).optional(),
  redeem: redeemSchema.default("none"),
  /** Куда вести для онлайн-погашения (только http и https: ссылка попадает в `href` на странице). */
  url: z
    .url()
    .refine((value) => /^https?:\/\//i.test(value), "Ссылка награды: только http или https")
    .optional()
});

export const streakSchema = z.object({
  /** День 0 «Подарок за старт»: шкала стартует не с нуля. */
  endowedDay: z.boolean().default(false),
  /** Реальный подарок за старт (например, промокод); без поля подаренный день — только шаг шкалы. Требует `endowedDay`. */
  endowedRewardId: id.optional(),
  freezes: z.number().int().min(0).max(ADVENT_LIMITS.freezes.max).default(0),
  comebackBonusRewardId: id.optional(),
  goals: z.array(z.object({ opened: z.number().int().min(1).max(ADVENT_LIMITS.days.max), rewardId: id })).default([])
});

export const luckSchema = z.object({
  skin: z.enum(["boxes", "wheel", "scratch"]).default("boxes"),
  /** Утешительный приз, если все призы пула закончились; должен быть без `stock`. */
  fallbackRewardId: id.optional()
});

export const remindersSchema = z.object({
  channel: z.enum(["email", "off"]).default("off"),
  sendAtLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время рассылки: HH:MM").default("10:00"),
  /** Тексты с плейсхолдерами `{day}` и `{teaser}`. */
  subject: z.string().min(1).default("Дверь {day} открыта"),
  preheader: z.string().min(1).default("{teaser}")
});

export const audienceSchema = z.object({
  kind: z.enum(["customers", "employees"]).default("customers"),
  leaderboard: z.enum(["off", "individual", "teams"]).default("off"),
  teams: z.array(z.object({ id, title: z.string().min(1) })).optional()
});

const storyBlockSchema = z.object({
  type: z.literal("story"),
  lines: z.array(z.string().min(1)).min(ADVENT_LIMITS.chapterLines.min).max(ADVENT_LIMITS.chapterLines.max)
});
const taskBlockSchema = z.object({ type: z.literal("task"), task: taskSchema });
const luckBlockSchema = z.object({
  type: z.literal("luck"),
  choices: z.number().int().min(ADVENT_LIMITS.luckChoices.min).max(ADVENT_LIMITS.luckChoices.max),
  pool: z.array(z.object({ rewardId: id, weight: z.number().int().min(1).max(1000) })).min(1)
});
const promoBlockSchema = z.object({ type: z.literal("promo"), rewardId: id });

/** Блок дня. Блок `word` («слово дня») появится на втором этапе и в схему пока не входит. */
export const dayBlockSchema = z.discriminatedUnion("type", [storyBlockSchema, taskBlockSchema, luckBlockSchema, promoBlockSchema]);

export const daySchema = z.object({
  n: z.number().int().min(1).max(ADVENT_LIMITS.days.max),
  title: z.string().min(1),
  /** Короткий анонс: в письме-напоминании и на закрытой двери. */
  teaser: z.string().min(1),
  /** Точка мира; без неё берётся `worldPath[(n − 1) % длина]` (см. `daySpotId`). */
  spotId: id.optional(),
  heroId: id.optional(),
  chapter: z.object({
    lines: z.array(z.string().min(1)).min(ADVENT_LIMITS.chapterLines.min).max(ADVENT_LIMITS.chapterLines.max)
  }),
  blocks: z.array(dayBlockSchema).min(ADVENT_LIMITS.dayBlocks.min).max(ADVENT_LIMITS.dayBlocks.max),
  /** Награда за закрытие дня. */
  rewardId: id.optional()
});

/**
 * Тексты интерфейса адвента: у каждого есть значение по умолчанию, пакет переопределяет только нужное.
 * Плейсхолдеры в фигурных скобках (`{n}`, `{date}`, `{label}`…) подставляет клиент.
 */
export const adventCopySchema = copySchema.extend({
  calendarTitle: z.string().min(1).default("Двери адвента"),
  doorLocked: z.string().min(1).default("Закрыта"),
  doorToday: z.string().min(1).default("Сегодня"),
  doorCatchup: z.string().min(1).default("Догнать"),
  doorMissed: z.string().min(1).default("Пропущена"),
  doorOpened: z.string().min(1).default("Открыта"),
  doorAria: z.string().min(1).default("День {n}: {status}"),
  doorLockedHint: z.string().min(1).default("Откроется {date}"),
  doorMissedHint: z.string().min(1).default("Этот день уже нельзя открыть"),
  doorFinaleHint: z.string().min(1).default("Двери больше не открываются"),
  upcomingEyebrow: z.string().min(1).default("Скоро старт"),
  upcomingTitle: z.string().min(1).default("Адвент откроется {date}"),
  upcomingNote: z.string().min(1).default("Загляните в первый день: мы приготовили сюрприз."),
  countdownDays: z.string().min(1).default("дн"),
  countdownHours: z.string().min(1).default("ч"),
  countdownMinutes: z.string().min(1).default("мин"),
  countdownSeconds: z.string().min(1).default("сек"),
  streakOpened: z.string().min(1).default("Открыто {k} из {n}"),
  streakCurrent: z.string().min(1).default("Серия"),
  streakBest: z.string().min(1).default("Лучшая серия"),
  streakFreezes: z.string().min(1).default("Заморозки"),
  streakGoal: z.string().min(1).default("До «{label}»: осталось дверей — {left}"),
  streakGoalDone: z.string().min(1).default("Все цели достигнуты"),
  comebackTitle: z.string().min(1).default("С возвращением!"),
  comebackText: z.string().min(1).default("Подарок за то, что вернулись."),
  comebackClose: z.string().min(1).default("Скрыть"),
  sheetClose: z.string().min(1).default("Закрыть день"),
  sheetOpening: z.string().min(1).default("Открываем дверь…"),
  chapterEyebrow: z.string().min(1).default("День {n}"),
  chapterNext: z.string().min(1).default("Дальше"),
  storyNext: z.string().min(1).default("Понятно, дальше"),
  outcomePerfect: z.string().min(1).default("Верно!"),
  outcomePartial: z.string().min(1).default("Почти получилось"),
  outcomeMiss: z.string().min(1).default("В этот раз не вышло"),
  outcomeCorrect: z.string().min(1).default("Правильный ответ"),
  outcomeNext: z.string().min(1).default("Дальше"),
  luckTitle: z.string().min(1).default("Испытайте удачу"),
  luckPromptBoxes: z.string().min(1).default("Выберите коробку"),
  luckPromptWheel: z.string().min(1).default("Выберите сектор колеса"),
  luckPromptScratch: z.string().min(1).default("Выберите карточку"),
  luckPending: z.string().min(1).default("Открываем…"),
  luckWon: z.string().min(1).default("Ваш подарок"),
  luckBoxLabel: z.string().min(1).default("Коробка {i}"),
  luckSectorLabel: z.string().min(1).default("Сектор {i}"),
  luckCardLabel: z.string().min(1).default("Карточка {i}"),
  promoTitle: z.string().min(1).default("Подарок дня"),
  promoOpen: z.string().min(1).default("Открыть подарок"),
  promoOpening: z.string().min(1).default("Открываем…"),
  promoCopy: z.string().min(1).default("Скопировать"),
  promoCopied: z.string().min(1).default("Код скопирован"),
  promoCopyFailed: z.string().min(1).default("Не удалось скопировать: выделите код вручную"),
  promoCode: z.string().min(1).default("Ваш код"),
  promoValidUntil: z.string().min(1).default("Действует до {date}"),
  promoRedeemed: z.string().min(1).default("Использован {date}"),
  promoExpired: z.string().min(1).default("Срок действия истёк"),
  promoCashier: z.string().min(1).default("Покажите код или QR кассиру"),
  promoOnline: z.string().min(1).default("Перейти на сайт"),
  promoNeedsIdentity: z.string().min(1).default("Код появится после входа по ссылке из письма"),
  promoCodePending: z.string().min(1).default("Код появится совсем скоро"),
  promoQrLabel: z.string().min(1).default("QR-код для кассы"),
  dayDoneTitle: z.string().min(1).default("День пройден"),
  dayDoneText: z.string().min(1).default("Возвращайтесь завтра: новая дверь ждёт."),
  dayDoneNoReward: z.string().min(1).default("Награда за этот день уже получена или не положена."),
  saveTitle: z.string().min(1).default("Сохраните прогресс"),
  saveText: z.string().min(1).default("Оставьте email: пришлём ссылку для входа, и серия с подарками не потеряются."),
  saveIdentityRequired: z.string().min(1).default("Чтобы получить этот приз, нужно сохранить прогресс: пришлём ссылку для входа на email."),
  saveEmail: z.string().min(1).default("Email"),
  saveConsent: z.string().min(1).default("Я согласен(на) на обработку персональных данных"),
  saveMarketing: z.string().min(1).default("Хочу получать напоминания о новых днях"),
  savePolicy: z.string().min(1).default("Политика обработки данных"),
  saveErrorEmail: z.string().min(1).default("Проверьте адрес email"),
  saveErrorConsent: z.string().min(1).default("Без согласия на обработку данных мы не можем отправить ссылку"),
  saveErrorSend: z.string().min(1).default("Не получилось отправить письмо. Попробуйте ещё раз"),
  saveSubmit: z.string().min(1).default("Отправить ссылку"),
  saveSending: z.string().min(1).default("Отправляем…"),
  saveSentTitle: z.string().min(1).default("Проверьте почту"),
  saveSentText: z.string().min(1).default("Мы отправили ссылку для входа на {email}. Откройте её на этом устройстве."),
  saveChange: z.string().min(1).default("Указать другой адрес"),
  saveDone: z.string().min(1).default("Прогресс сохранён: {email}"),
  finaleEyebrow: z.string().min(1).default("Финал"),
  finaleTitle: z.string().min(1).default("Итоги адвента"),
  finaleOpened: z.string().min(1).default("Открыто дверей"),
  finaleBest: z.string().min(1).default("Лучшая серия"),
  finaleMainPrize: z.string().min(1).default("Главный приз"),
  finaleNoPrize: z.string().min(1).default("Главный приз достаётся тем, кто открыл больше дверей. В следующий раз!"),
  finaleGoals: z.string().min(1).default("Цели"),
  finaleShare: z.string().min(1).default("Поделиться"),
  finaleShareText: z.string().min(1).default("Я прошёл(ла) адвент «{title}»: открыто {k} из {n}."),
  finaleShareCopied: z.string().min(1).default("Ссылка скопирована"),
  closedTitle: z.string().min(1).default("Адвент завершён"),
  closedText: z.string().min(1).default("Спасибо, что были с нами."),
  loading: z.string().min(1).default("Загружаем двери…"),
  retry: z.string().min(1).default("Повторить"),
  loginError: z.string().min(1).default("Ссылка для входа не сработала или устарела. Запросите новую."),
  errorGeneric: z.string().min(1).default("Не удалось загрузить адвент. Проверьте соединение.")
});
export type AdventCopy = z.infer<typeof adventCopySchema>;

const adventBaseSchema = campaignCoreSchema.extend({
  copy: adventCopySchema.prefault({}),
  presentation: presentationSchema.default("calendar"),
  schedule: scheduleSchema,
  streak: streakSchema.prefault({}),
  days: z.array(daySchema).min(ADVENT_LIMITS.days.min).max(ADVENT_LIMITS.days.max),
  rewards: z.array(rewardSchema).min(1),
  luck: luckSchema.optional(),
  reminders: remindersSchema.prefault({}),
  audience: audienceSchema.prefault({})
});

/** Точка мира для дня: явный `spotId` или точка пути по кругу, если точек меньше, чем дней. */
export function daySpotId(day: { n: number; spotId?: string }, worldPath: readonly string[]): string {
  if (day.spotId) return day.spotId;
  if (worldPath.length === 0) throw new Error("У мира нет пути (path): задайте spotId дня явно");
  return worldPath[(day.n - 1) % worldPath.length];
}

export const adventSchema = adventBaseSchema.superRefine((advent, context) => {
  const heroIds = checkCoreHeroes(context, advent.heroes);
  const { schedule } = advent;

  const dayNumbers = advent.days.map((day) => day.n).sort((a, b) => a - b);
  if (advent.days.length !== schedule.days || dayNumbers.some((n, index) => n !== index + 1)) {
    issue(context, `Дни должны идти подряд от 1 до ${schedule.days} (schedule.days) без пропусков и повторов`, ["days"]);
  }

  const rewardIds = advent.rewards.map((reward) => reward.id);
  if (new Set(rewardIds).size !== rewardIds.length) {
    issue(context, "Id наград (rewards) повторяются", ["rewards"]);
  }
  const rewardsById = new Map(advent.rewards.map((reward) => [reward.id, reward]));
  const checkReward = (rewardId: string | undefined, where: string, path: Array<string | number>) => {
    if (rewardId !== undefined && !rewardsById.has(rewardId)) {
      issue(context, `Неизвестная награда в ${where}: ${rewardId}`, path);
    }
  };

  const tasks = advent.days.flatMap((day) => day.blocks.flatMap((block) => (block.type === "task" ? [block.task] : [])));
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    issue(context, "Id заданий в днях повторяются", ["days"]);
  }

  advent.days.forEach((day, dayIndex) => {
    const dayPath = ["days", dayIndex];
    if (day.heroId && !heroIds.has(day.heroId)) {
      issue(context, `Неизвестный герой в дне ${day.n}: ${day.heroId}`, [...dayPath, "heroId"]);
    }
    checkReward(day.rewardId, `дне ${day.n}`, [...dayPath, "rewardId"]);
    // Зерно розыгрыша — (кампания, участник, день): второй блок удачи в тот же день выпал бы так же, как первый.
    if (day.blocks.filter((block) => block.type === "luck").length > 1) {
      issue(context, `В дне ${day.n} больше одного блока удачи: допускается один`, [...dayPath, "blocks"]);
    }

    day.blocks.forEach((block, blockIndex) => {
      const blockPath = [...dayPath, "blocks", blockIndex];
      if (block.type === "promo") {
        checkReward(block.rewardId, `блоке promo дня ${day.n}`, [...blockPath, "rewardId"]);
        // Подарок дня и награда за закрытие дня хранятся одной выдачей (ключ «участник, day, день»): два разных приза не поместились бы.
        if (day.rewardId !== undefined && day.rewardId !== block.rewardId) {
          issue(context, `В дне ${day.n} блок promo (${block.rewardId}) и rewardId дня (${day.rewardId}) различаются: за день выдаётся один подарок`, [...blockPath, "rewardId"]);
        }
      }
      if (block.type === "task") {
        const { task } = block;
        if (!heroIds.has(task.heroId)) {
          issue(context, `Неизвестный герой в задании ${task.id}: ${task.heroId}`, [...blockPath, "task", "heroId"]);
        }
        for (const variant of taskVariants(task)) {
          if (REVEALING_ID_PATTERN.test(variant.id)) {
            issue(context, `Id варианта в задании ${task.id} подсказывает ответ: ${variant.id}`, [...blockPath, "task"]);
          }
        }
        if (task.type !== "phish") {
          const cards = task.type === "access" ? task.switches : task.type === "order" ? task.items : task.options;
          for (const card of cards) {
            if (!isKnownIcon(card.icon)) issue(context, `Неизвестная иконка «${card.icon}» в задании ${task.id}`, [...blockPath, "task"]);
          }
        }
      }
      if (block.type === "luck") {
        if (!advent.luck) {
          issue(context, `В дне ${day.n} есть блок удачи, но не задана секция luck`, [...blockPath, "type"]);
        }
        const poolIds = block.pool.map((item) => item.rewardId);
        if (new Set(poolIds).size !== poolIds.length) {
          issue(context, `Награды в пуле удачи дня ${day.n} повторяются`, [...blockPath, "pool"]);
        }
        for (const item of block.pool) {
          checkReward(item.rewardId, `пуле удачи дня ${day.n}`, [...blockPath, "pool"]);
          if (REVEALING_ID_PATTERN.test(item.rewardId) || LUCK_VALUE_ID_PATTERN.test(item.rewardId)) {
            issue(context, `Id награды в пуле удачи дня ${day.n} выдаёт её ценность: ${item.rewardId}`, [...blockPath, "pool"]);
          }
        }
        const fallback = advent.luck?.fallbackRewardId ? rewardsById.get(advent.luck.fallbackRewardId) : undefined;
        const guaranteed =
          block.pool.some((item) => rewardsById.get(item.rewardId)?.stock === undefined && rewardsById.has(item.rewardId)) ||
          (fallback !== undefined && fallback.stock === undefined);
        if (!guaranteed) {
          issue(
            context,
            `В пуле удачи дня ${day.n} нет гарантированного приза: добавьте награду без stock или задайте luck.fallbackRewardId на награду без stock`,
            [...blockPath, "pool"]
          );
        }
      }
    });
  });

  if (advent.luck?.fallbackRewardId !== undefined) {
    checkReward(advent.luck.fallbackRewardId, "luck.fallbackRewardId", ["luck", "fallbackRewardId"]);
    if (rewardsById.get(advent.luck.fallbackRewardId)?.stock !== undefined) {
      issue(context, "Утешительный приз luck.fallbackRewardId не должен иметь stock", ["luck", "fallbackRewardId"]);
    }
  }

  checkReward(advent.streak.comebackBonusRewardId, "streak.comebackBonusRewardId", ["streak", "comebackBonusRewardId"]);
  checkReward(advent.streak.endowedRewardId, "streak.endowedRewardId", ["streak", "endowedRewardId"]);
  if (advent.streak.endowedRewardId !== undefined && !advent.streak.endowedDay) {
    issue(context, "streak.endowedRewardId задан, а подаренного дня нет: включите streak.endowedDay", ["streak", "endowedRewardId"]);
  }
  advent.streak.goals.forEach((goal, index) => {
    checkReward(goal.rewardId, "streak.goals", ["streak", "goals", index, "rewardId"]);
    if (goal.opened > schedule.days) {
      issue(context, `Цель «открыть ${goal.opened}» недостижима: дней всего ${schedule.days}`, ["streak", "goals", index, "opened"]);
    }
  });
  if (new Set(advent.streak.goals.map((goal) => goal.opened)).size !== advent.streak.goals.length) {
    issue(context, "Цели серии с одинаковым числом открытых дней повторяются", ["streak", "goals"]);
  }

  const teams = advent.audience.teams ?? [];
  if (advent.audience.leaderboard === "teams" && teams.length === 0) {
    issue(context, "Для рейтинга по командам (leaderboard: teams) нужен список audience.teams", ["audience", "teams"]);
  }
  if (advent.audience.leaderboard !== "teams" && teams.length > 0) {
    issue(context, "Команды audience.teams нужны только при leaderboard: teams", ["audience", "teams"]);
  }
  if (new Set(teams.map((team) => team.id)).size !== teams.length) {
    issue(context, "Id команд (audience.teams) повторяются", ["audience", "teams"]);
  }

  // Часовой пояс и дата начала уже отвергнуты полевыми проверками: считать по ним даты нельзя.
  const calendarValid = isIanaTimezone(schedule.timezone) && isRealDate(schedule.startDate);
  if (calendarValid && new Date(schedule.finaleAt).getTime() <= dayUnlockAt(schedule.days, schedule).getTime()) {
    issue(context, "Финал (finaleAt) должен быть позже открытия последнего дня", ["schedule", "finaleAt"]);
  }
  if (new Date(schedule.claimEndsAt).getTime() < new Date(schedule.finaleAt).getTime()) {
    issue(context, "Конец выдачи кодов (claimEndsAt) не может быть раньше финала (finaleAt)", ["schedule", "claimEndsAt"]);
  }

  checkBrandContrast(context, advent.brand);
});

export type AdventConfig = z.infer<typeof adventSchema>;
export type AdventSchedule = z.infer<typeof scheduleSchema>;
export type AdventReward = z.infer<typeof rewardSchema>;
export type AdventDay = z.infer<typeof daySchema>;
export type DayBlock = z.infer<typeof dayBlockSchema>;
