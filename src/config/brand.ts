import { z } from "zod";

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Цвет в формате #RRGGBB");

/**
 * Шрифты на выбор: только кириллические из Google Fonts через `next/font` (подключены в `src/app/fonts.ts`).
 * Произвольный шрифт из пакета не принимается: так нет внешних запросов с браузера игрока.
 */
export const FONT_IDS = ["onest", "inter", "manrope", "montserrat", "nunito", "rubik"] as const;
export type FontId = (typeof FONT_IDS)[number];

export const brandColorsSchema = z.object({
  bg: hex,
  panel: hex,
  ink: hex,
  accent: hex,
  accent2: hex,
  highlight: hex,
  danger: hex,
  success: hex
});

const derivedSchema = z
  .object({
    card: hex,
    card2: hex,
    muted: hex,
    muted2: hex,
    highlightSoft: hex,
    paper: hex,
    paperInk: hex,
    inkSoft: hex,
    line: z.string().regex(/^(#[0-9A-Fa-f]{6,8}|rgba?\([0-9\s.,%]+\))$/, "Цвет: #RRGGBB(AA) или rgba(...)"),
    onAccent: hex,
    onHighlight: hex,
    haze: hex,
    ice: hex,
    deep: hex,
    void: hex,
    patch: hex,
    royal: hex,
    track: hex,
    track2: hex,
    dim: hex,
    amber: hex,
    dangerStrong: hex,
    alarm: hex
  })
  .partial();

/** Бренд арендатора: имя, логотип, палитра, шрифт и подписи: всё, что видит игрок, берётся из пакета, а не из кода. */
export const brandSchema = z.object({
  /** Название бренда для вкладки, писем, соцсетей. */
  name: z.string().trim().min(1).max(60),
  /** Короткая отметка логотипа в плашке (1–3 символа), если нет картинки. */
  mark: z.string().trim().min(1).max(4),
  /** Слово рядом с отметкой. */
  wordmark: z.string().trim().min(1).max(30),
  /** Путь к логотипу в `public/` (например, `/tenants/demo-coffee/logo.svg`); показывается вместо отметки. */
  logo: z.string().regex(/^\/[A-Za-z0-9/_.-]+\.(svg|png|webp)$/).refine((path) => !path.includes(".."), "Без «..» в пути").optional(),
  /** Фон картинки «Поделиться» (JPEG/PNG: Satori не рисует WebP). */
  ogBackground: z
    .string()
    .regex(/^\/[A-Za-z0-9/_.-]+\.(jpg|jpeg|png)$/)
    .refine((path) => !path.includes(".."), "Без «..» в пути")
    .default("/art/og-hero.jpg"),
  /** Декоративный фон страницы «Поделиться» (WebP/JPEG/PNG в `public/`); без него — только цвет `bg`. */
  pageArt: z
    .string()
    .regex(/^\/[A-Za-z0-9_.-][A-Za-z0-9/_.-]*\.(webp|jpg|jpeg|png)$/, "Путь в public/ от корня, без «//» в начале (внешний домен)")
    .refine((path) => !path.includes(".."), "Без «..» в пути")
    .optional(),
  font: z.enum(FONT_IDS).default("onest"),
  colors: brandColorsSchema,
  derived: derivedSchema.default({}),
  /** Заметка справа в шапке: «Финальный рывок · 2026». */
  topNote: z.string().trim().min(1).max(60).default("Новогодний квиз"),
  /** Подпись под карточкой результата и описание сайта. */
  tagline: z.string().trim().min(1).max(120),
  /** Призыв на картинке «Поделиться». */
  ogCall: z.string().trim().min(1).max(100),
  /** Тема письма с подтверждением. */
  mailSubject: z.string().trim().min(1).max(120)
});

/** Метафора и голос: места и реплики, которые зависят от того, во что «играет» заказчик. */
export const storySchema = z.object({
  /** Заголовок мира на карте и в шапке. */
  placeTitle: z.string().trim().min(1).max(60),
  /** Первая реплика гида в прологе. */
  guideIntro: z.string().trim().min(1).max(240),
  landingAlt: z.string().trim().min(1).max(160),
  finaleAlt: z.string().trim().min(1).max(160),
  shareCardAlt: z.string().trim().min(1).max(160),
  /** «Я запустил цифровой офис» — заголовок карточки результата и начало текста «Поделиться». */
  shareHeadline: z.string().trim().min(1).max(80),
  /** Подпись под счётом: «очков · офис запущен к полуночи». */
  shareSubline: z.string().trim().min(1).max(80),
  /** Строка на публичной странице результата. */
  shareLead: z.string().trim().min(1).max(160)
});

/** Тексты интерфейса с дефолтами: пакет переопределяет только нужное. Метафора по умолчанию — игрушки на ёлку. */
export const copySchema = z.object({
  ornamentsMapLabel: z.string().min(1).default("Игрушки на ёлку"),
  ornamentsAria: z.string().min(1).default("Игрушки на ёлке"),
  newOrnament: z.string().min(1).default("Новая игрушка на ёлку"),
  ornamentName: z.string().min(1).default("Игрушка:"),
  hangOrnament: z.string().min(1).default("К ёлке: повесить игрушку")
});

export type Brand = z.infer<typeof brandSchema>;
export type Story = z.infer<typeof storySchema>;
export type Copy = z.infer<typeof copySchema>;
