import { z } from "zod";

import { adventSchema } from "@/config/advent-schema";
import { PROFILE_IDS } from "@/config/advent-profile";
import { campaignSchema } from "@/config/schema";

/** Короткое имя пакета: папка `tenants/<slug>/`, поддомен и значение переменной `TENANT`. */
export const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** Мир, который получает пакет без `worldId`. */
export const DEFAULT_WORLD_ID = "snow-globe";

const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/, "Host без схемы и пути: example.com или localhost:3000");

/**
 * Пакет арендатора — всё, что отличает один квиз от другого. Механика (очки, сессии, заявки) общая.
 * Бренд, story и copy добавляются в этапе 2, мир — в этапе 3 (`worldId` ссылается на `worlds/<id>/`).
 */
export const packSchema = z.object({
  /** Вид пакета; без поля пакет считается квизом. */
  experience: z.literal("quiz").default("quiz"),
  tenant: z.string().regex(TENANT_SLUG_PATTERN),
  /** Домены, по которым открывается этот квиз (точное совпадение Host, регистр не важен). */
  hosts: z.array(hostSchema).default([]),
  worldId: z.string().regex(TENANT_SLUG_PATTERN).default(DEFAULT_WORLD_ID),
  campaign: campaignSchema
});

/**
 * Адвент-пакет: те же `tenant`, `hosts` и `worldId`, но вместо `campaign` — `advent` (`advent-schema.ts`).
 * Рантайм адвента появится на этапе A1; пока такой пакет проверяется схемой, но в `tenants/index.ts` не попадает.
 */
export const adventPackSchema = z.object({
  experience: z.literal("advent"),
  tenant: z.string().regex(TENANT_SLUG_PATTERN),
  hosts: z.array(hostSchema).default([]),
  worldId: z.string().regex(TENANT_SLUG_PATTERN).default("snow-globe"),
  /** Профиль бизнеса, из которого `quiz:new` взял значения по умолчанию; в рантайме не используется. */
  profile: z.enum([...PROFILE_IDS, "custom"]),
  /** Витринный пакет для демонстрации, не боевая кампания. */
  demo: z.boolean().default(false),
  /** Сколько участников ждём (оценка заказчика): `quiz:check` сверяет с ней запас кодов из списков. */
  expectedParticipants: z.number().int().min(1).optional(),
  advent: adventSchema
});

/** Любой пакет: по `experience` выбирается схема; отсутствие поля означает квиз. */
export const anyPackSchema = z.preprocess(
  (raw) =>
    typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw as { experience?: unknown }).experience === undefined
      ? { ...raw, experience: "quiz" }
      : raw,
  z.discriminatedUnion("experience", [packSchema, adventPackSchema])
);

export type TenantPack = z.infer<typeof packSchema>;
export type AdventPack = z.infer<typeof adventPackSchema>;
export type AnyPack = TenantPack | AdventPack;
