import { z } from "zod";

import { contrastRatio, mix } from "@/domain/color";

/**
 * Цветовые роли фасада берутся из производных токенов бренда (`deriveTheme`, src/config/theme.ts): в шаблоне
 * хранится имя токена, а не цвет. Закрытый список не даёт подставить hex и сам по себе гарантирует, что фасад
 * перекрашивается вместе с брендом пакета.
 */
export const FACADE_TOKENS = [
  "bg", "panel", "card", "card-2", "deep", "patch", "royal", "void", "track", "track-2", "haze", "ice",
  "blue", "cyan", "gold", "gold-soft", "amber", "green", "coral", "ink", "paper", "paper-ink", "on-gold", "on-accent"
] as const;
export const facadeTokenSchema = z.enum(FACADE_TOKENS);
export type FacadeToken = z.infer<typeof facadeTokenSchema>;

const id = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, "id фасада: строчные латинские буквы, цифры и дефис");

/** `cooling` — плоская крыша с блоками охлаждения и вентиляторами (дата-центр); `unit` — окно-юнит стойки: узкая прорезь с номером дня и рядом диодов; `hatch` — гермодверь машинного зала. */
export const ROOF_SHAPES = ["gable", "flat", "dome", "cooling"] as const;
export const WINDOW_SHAPES = ["arch", "square", "round", "unit"] as const;
export const DOOR_SHAPES = ["arch", "square", "round", "hatch"] as const;

/** Роли цвета: стена, крыша, обводка окон, стекло закрытого окна, свет открытого, дверь, земля, вывеска. */
export const facadeColorsSchema = z.strictObject({
  wall: facadeTokenSchema,
  roof: facadeTokenSchema,
  trim: facadeTokenSchema,
  glass: facadeTokenSchema,
  glow: facadeTokenSchema,
  /** Цвет текста и значков на свете открытого окна. */
  glowInk: facadeTokenSchema,
  door: facadeTokenSchema,
  ground: facadeTokenSchema,
  sign: facadeTokenSchema,
  /** Цвет текста вывески. */
  signInk: facadeTokenSchema
});
export type FacadeColors = z.infer<typeof facadeColorsSchema>;

/**
 * Шаблон фасада: форма и цвета, без контента бизнеса. Рисуется на клиенте инлайновым SVG и CSS, растровых картинок нет.
 * Раскладку окон по сетке считает `facadeLayout` (src/domain/advent/facade-layout.ts).
 */
export const facadeSchema = z.strictObject({
  id,
  title: z.string().min(1),
  roof: z.strictObject({
    shape: z.enum(ROOF_SHAPES),
    /** Полосатая маркиза под крышей (магазин). */
    awning: z.boolean().default(false)
  }),
  windows: z.strictObject({
    shape: z.enum(WINDOW_SHAPES),
    /** Переплёт: одно стекло, крест или панорамное стекло без перегородок. */
    panes: z.enum(["single", "cross", "panorama"]).default("single")
  }),
  door: z.strictObject({ shape: z.enum(DOOR_SHAPES) }),
  decor: z.strictObject({
    /** Огоньки по краю крыши (украшение, не шкала: шкала — гирлянда над фасадом). */
    garland: z.boolean().default(true),
    snow: z.boolean().default(true),
    /** Вывеска над дверью с названием бренда или `signText`. */
    sign: z.boolean().default(true)
  }),
  layout: z.strictObject({
    /** Финальное окно — «мансарда» шириной 2 колонки по центру сверху; без неё оно стоит в ряду последним. */
    attic: z.boolean().default(true),
    /** Колонок сетки окон: 4 (обычная) или 2 (узкие юниты стойки: пара в ряду, дверь в три ряда высотой). */
    columns: z.union([z.literal(4), z.literal(2)]).default(4)
  }),
  /** Предметная обложка заданий «собери»: чашка со слоями для кофейни, коробка для остальных. */
  vessel: z.enum(["cup", "box", "stack"]).default("box"),
  colors: facadeColorsSchema
});
export type Facade = z.infer<typeof facadeSchema>;

/** Значки-декор: открытое окно без полученной награды показывает один из них (звезды среди них нет: звезда — сегодняшнее окно). */
export const DAY_DECOR_ICONS = ["leaf", "sparkle", "book", "recipe"] as const;

/** Выбор фасада в пакете: шаблон, герой-хозяин у двери и текст вывески. */
export const facadeChoiceSchema = z.strictObject({
  templateId: id,
  /** Герой, который стоит в двери; без поля — первый герой пакета. */
  hostHeroId: z.string().min(1).max(64).optional(),
  /** Текст вывески; без поля — название бренда. */
  signText: z.string().trim().min(1).max(28).optional()
});
export type FacadeChoice = z.infer<typeof facadeChoiceSchema>;

/** Разбор шаблона фасада; бросает с перечнем всех проблем. */
export function parseFacade(raw: unknown): Facade {
  return facadeSchema.parse(raw);
}

/** Окно «горит»: свет смешивается со стеклом, поэтому текст на нём проверяется на самом тёмном месте градиента. */
const LIT_GLASS_SHARE = 0.82;

/**
 * Контраст текста фасада на палитре бренда (WCAG AA, 4.5): цифра на тёмном стекле, текст на свете открытого окна
 * (худший край градиента окна) и текст вывески. Пустой список — фасад читается. Вызывается из `quiz:check` и тестов.
 */
export function facadeContrastIssues(facade: Facade, theme: Record<string, string>): string[] {
  const color = (token: FacadeToken) => theme[token];
  const { colors } = facade;
  const litBackground = mix(color(colors.glass), color(colors.glow), LIT_GLASS_SHARE);
  const pairs: Array<[string, string, string]> = [
    ["цифра на стекле закрытого окна", color("ink"), color(colors.glass)],
    ["цифра на заиндевевшем стекле", color("ink"), mix(color(colors.glass), color("ice"), 0.22)],
    ["цифра на свете открытого окна", color(colors.glowInk), litBackground],
    ["цифра на свете открытого окна (середина)", color(colors.glowInk), color(colors.glow)],
    ["текст вывески", color(colors.signInk), color(colors.sign)]
  ];
  return pairs
    .filter(([, foreground, background]) => contrastRatio(foreground, background) < 4.5)
    .map(([name, foreground, background]) => `фасад ${facade.id}: ${name}: ${foreground} на ${background} даёт контраст ${contrastRatio(foreground, background).toFixed(2)} (< 4.5)`);
}
