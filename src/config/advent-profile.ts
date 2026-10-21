import { z } from "zod";

import { facadeChoiceSchema } from "@/config/facade";
import { catchUpSchema, presentationSchema, remindersSchema, rewardSchema, timezoneSchema } from "@/config/advent-schema";

/** Типы бизнеса, для которых есть заготовка в `profiles/<id>.json`. Пакет может быть и `custom` — без профиля. */
export const PROFILE_IDS = ["retail", "horeca", "beauty", "b2b", "corporate"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

const id = z.string().min(1).max(64);

/** Цель серии в профиле: доля дней (0 < x ≤ 1), а не число, — профиль не знает длину адвента. */
const profileGoalSchema = z.strictObject({ openedShare: z.number().gt(0).max(1), rewardId: id });
export type ProfileGoal = z.infer<typeof profileGoalSchema>;

/**
 * Цели профиля для адвента на `days` дней: `opened = max(1, ⌈share × days⌉)` (с допуском на погрешность float,
 * чтобы 0.3 × 10 дало 3, а не 4). Если две цели дают одинаковый `opened`, остаётся первая по порядку в профиле,
 * следующие отбрасываются: молча, потому что для профилей из `profiles/` такие совпадения на 5–31 днях запрещает
 * `adventProfileSchema` (ошибка «цели совпадают»).
 */
export function resolveProfileGoals(goals: readonly ProfileGoal[], days: number): Array<{ opened: number; rewardId: string }> {
  const seen = new Set<number>();
  const resolved: Array<{ opened: number; rewardId: string }> = [];
  for (const goal of goals) {
    const opened = Math.min(days, Math.max(1, Math.ceil(goal.openedShare * days - 1e-9)));
    if (seen.has(opened)) continue;
    seen.add(opened);
    resolved.push({ opened, rewardId: goal.rewardId });
  }
  return resolved;
}

/** Шаблон дня: подсказка автору пакета (какие блоки поставить и о чём писать). В игру не попадает. */
const dayTemplateSchema = z.strictObject({
  id,
  title: z.string().min(1),
  teaser: z.string().min(1),
  blocks: z.array(z.enum(["story", "task", "luck", "promo"])).min(1).max(3),
  hint: z.string().min(1)
});

/**
 * Профиль бизнеса — частичный `adventSchema` со значениями по умолчанию плюс заметки для автора.
 * Поля без значения по умолчанию в схеме (даты, герои, дни, бренд) не входят: их задаёт сам пакет.
 * Секции частичные и без значений по умолчанию, чтобы при слиянии не затирать то, что задал пакет.
 */
export const adventProfileSchema = z.strictObject({
  id: z.enum(PROFILE_IDS),
  title: z.string().min(1),
  /** Подсказки по тону текстов для автора пакета и агента `quiz:new`. */
  toneHints: z.array(z.string().min(1)).min(1),
  presentation: presentationSchema.optional(),
  /** Фасад «Витрины» по умолчанию для этого типа бизнеса: кофейни — cafe, магазины — shop, B2B и команды — office, салоны — salon (IT и облако выбирают datacenter вручную). */
  facade: z.strictObject({ templateId: facadeChoiceSchema.shape.templateId }).optional(),
  schedule: z
    .strictObject({
      timezone: timezoneSchema.optional(),
      days: z.number().int().min(5).max(31).optional(),
      unlockHour: z.number().int().min(0).max(23).optional(),
      catchUp: catchUpSchema.optional(),
      rewardOnlyOnDay: z.boolean().optional()
    })
    .optional(),
  streak: z
    .strictObject({
      endowedDay: z.boolean().optional(),
      freezes: z.number().int().min(0).max(3).optional(),
      comebackBonusRewardId: id.optional(),
      /** Цели долей дней: `applyProfile` пересчитывает их в `opened` под `schedule.days` пакета (`resolveProfileGoals`). */
      goals: z.array(profileGoalSchema).optional()
    })
    .optional(),
  rewards: z.array(rewardSchema).optional(),
  luck: z
    .strictObject({ skin: z.enum(["boxes", "wheel", "scratch"]).optional(), fallbackRewardId: id.optional() })
    .optional(),
  reminders: z
    .strictObject({
      channel: remindersSchema.shape.channel.unwrap().optional(),
      sendAtLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      subject: z.string().min(1).optional(),
      preheader: z.string().min(1).optional()
    })
    .optional(),
  audience: z
    .strictObject({
      kind: z.enum(["customers", "employees"]).optional(),
      leaderboard: z.enum(["off", "individual", "teams"]).optional()
    })
    .optional(),
  dayTemplates: z.array(dayTemplateSchema).optional()
}).superRefine((profile, context) => {
  const rewardIds = new Set((profile.rewards ?? []).map((reward) => reward.id));
  const refs: Array<{ rewardId: string | undefined; path: Array<string | number> }> = [
    { rewardId: profile.streak?.comebackBonusRewardId, path: ["streak", "comebackBonusRewardId"] },
    { rewardId: profile.luck?.fallbackRewardId, path: ["luck", "fallbackRewardId"] },
    ...(profile.streak?.goals ?? []).map((goal, index) => ({ rewardId: goal.rewardId, path: ["streak", "goals", index, "rewardId"] }))
  ];
  for (const { rewardId, path } of refs) {
    if (rewardId !== undefined && !rewardIds.has(rewardId)) {
      context.addIssue({ code: "custom", message: `Профиль ссылается на награду, которой нет в rewards: ${rewardId}`, path });
    }
  }
  const goals = profile.streak?.goals ?? [];
  for (let days = 5; days <= 31; days += 1) {
    if (resolveProfileGoals(goals, days).length !== goals.length) {
      context.addIssue({
        code: "custom",
        message: `Цели серии совпадают при ${days} днях: доли openedShare слишком близки`,
        path: ["streak", "goals"]
      });
      break;
    }
  }
});

export type AdventProfile = z.infer<typeof adventProfileSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Ключи, через которые JSON-черновик мог бы подменить прототип результата: при слиянии пропускаются. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function merge(base: unknown, override: unknown): unknown {
  if (override === undefined) return structuredClone(base);
  if (isPlainObject(override)) {
    // Объект черновика тоже проходит по ключам, даже если в профиле на этом месте не объект: так отсеиваются UNSAFE_KEYS.
    const source = isPlainObject(base) ? base : {};
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(source), ...Object.keys(override)])) {
      if (UNSAFE_KEYS.has(key)) continue;
      result[key] = merge(source[key], override[key]);
    }
    return result;
  }
  // Массив черновика заменяет массив профиля целиком, но его объекты тоже проходят через фильтр UNSAFE_KEYS.
  if (Array.isArray(override)) return override.map((item) => merge(undefined, item));
  return structuredClone(override);
}

/** Поля профиля, которые описывают сам профиль и в пакет не переносятся. */
const PROFILE_ONLY_KEYS = ["id", "title", "toneHints", "dayTemplates"] as const;

/**
 * Подмешивает профиль в черновик пакета (`advent`): значения черновика важнее, объекты сливаются по ключам,
 * массивы заменяются целиком, а не склеиваются. Поля, описывающие сам профиль (`id`, `title`, `toneHints`,
 * `dayTemplates`), в результат не попадают. Исходные объекты не изменяются.
 *
 * Цели серии профиля (доли) пересчитываются в `opened` через `resolveProfileGoals`, если в черновике (или в самом
 * профиле) есть `schedule.days`. Свои `streak.goals` черновика важнее. Без `schedule.days` цели профиля не переносятся:
 * считать их не от чего.
 */
export function applyProfile(profile: AdventProfile, draft: Record<string, unknown>): Record<string, unknown> {
  const defaults: Record<string, unknown> = { ...profile };
  for (const key of PROFILE_ONLY_KEYS) delete defaults[key];
  if (profile.streak) {
    const { goals, ...streak } = profile.streak;
    const schedule = isPlainObject(draft.schedule) ? draft.schedule : {};
    const days = schedule.days ?? profile.schedule?.days;
    defaults.streak =
      goals !== undefined && typeof days === "number" && Number.isInteger(days) && days > 0
        ? { ...streak, goals: resolveProfileGoals(goals, days) }
        : streak;
  }
  return merge(defaults, draft) as Record<string, unknown>;
}
