import { contrastRatio, mix, readableOn } from "@/domain/color";

/** Восемь цветов бренда, которые задаёт пакет арендатора. */
export type BrandColors = {
  /** Фон страницы. */
  bg: string;
  /** Панели и карточки. */
  panel: string;
  /** Основной текст на фоне. */
  ink: string;
  /** Главная кнопка и акценты. */
  accent: string;
  /** Вторичный акцент: ссылки, подписи, фокус. */
  accent2: string;
  /** Подсветка: очки, награда, золотая кнопка. */
  highlight: string;
  /** Предупреждения. */
  danger: string;
  /** Успех. */
  success: string;
};

/** Необязательные переопределения производных цветов (пакет задаёт их, например, чтобы цвета совпали с иллюстрацией мира). */
export type DerivedColors = Partial<
  Record<
    | "card" | "card2" | "muted" | "muted2" | "highlightSoft" | "paper" | "paperInk" | "inkSoft" | "line" | "onAccent" | "onHighlight"
    | "haze" | "ice" | "deep" | "void" | "patch" | "royal" | "track" | "track2" | "dim" | "amber" | "dangerStrong" | "alarm",
    string
  >
>;

/** Полный набор CSS-переменных (без `--`). Совпадает с именами в `globals.css`. */
export function deriveTheme(colors: BrandColors, overrides: DerivedColors = {}): Record<string, string> {
  const onAccent = overrides.onAccent ?? readableOn(colors.accent, ["#ffffff", "#0b1220"]);
  const onHighlight = overrides.onHighlight ?? readableOn(colors.highlight, ["#1b1300", "#ffffff"]);
  return {
    bg: colors.bg,
    panel: colors.panel,
    card: overrides.card ?? mix(colors.panel, colors.accent, 0.1),
    "card-2": overrides.card2 ?? mix(colors.panel, colors.accent, 0.3),
    ink: colors.ink,
    muted: overrides.muted ?? mix(colors.ink, colors.bg, 0.35),
    "muted-2": overrides.muted2 ?? mix(colors.ink, colors.bg, 0.15),
    line: overrides.line ?? `${mix(colors.ink, colors.accent, 0.4)}2e`,
    cyan: colors.accent2,
    gold: colors.highlight,
    "gold-soft": overrides.highlightSoft ?? mix(colors.highlight, "#ffffff", 0.45),
    coral: colors.danger,
    green: colors.success,
    blue: colors.accent,
    paper: overrides.paper ?? mix(colors.ink, "#ffffff", 0.4),
    "paper-ink": overrides.paperInk ?? colors.panel,
    "ink-soft": overrides.inkSoft ?? mix(colors.panel, colors.ink, 0.35),
    "on-accent": onAccent,
    "on-gold": onHighlight,
    // Оттенки для теней, свечений и фонов: в CSS нет захардкоженных цветов, всё берётся отсюда.
    haze: overrides.haze ?? mix(colors.ink, colors.accent, 0.4),
    ice: overrides.ice ?? mix(colors.ink, colors.accent2, 0.3),
    deep: overrides.deep ?? mix(colors.bg, colors.accent, 0.15),
    void: overrides.void ?? mix(colors.bg, "#000000", 0.4),
    patch: overrides.patch ?? mix(colors.bg, colors.accent, 0.25),
    royal: overrides.royal ?? mix(colors.accent, colors.bg, 0.3),
    track: overrides.track ?? mix(colors.panel, colors.ink, 0.08),
    "track-2": overrides.track2 ?? mix(colors.panel, colors.ink, 0.16),
    dim: overrides.dim ?? mix(colors.ink, colors.bg, 0.55),
    amber: overrides.amber ?? mix(colors.highlight, "#e08a00", 0.4),
    "danger-strong": overrides.dangerStrong ?? mix(colors.danger, "#000000", 0.35),
    alarm: overrides.alarm ?? colors.danger
  };
}

/** Блок `:root { … }` с переменными темы. Значения прошли проверку `#RRGGBB`, поэтому вставка в `<style>` безопасна. */
export function themeCss(colors: BrandColors, overrides: DerivedColors, fontStack: string, pageArt?: string): string {
  const entries = Object.entries(deriveTheme(colors, overrides)).map(([name, value]) => `--${name}:${value}`);
  // Путь прошёл regex схемы бренда, поэтому в кавычках url() безопасен; `//host/…` — внешний домен, не пускаем.
  const art = pageArt && /^\/[A-Za-z0-9_.-][A-Za-z0-9/_.-]*$/.test(pageArt) ? `url("${pageArt}")` : "none";
  return `html:root{${entries.join(";")};--font:${fontStack};--page-art:${art}}`;
}

/** Пары «текст на фоне», которые должны читаться (WCAG AA для обычного текста — 4.5, для крупного и иконок — 3). */
export function contrastIssues(colors: BrandColors, overrides: DerivedColors = {}): string[] {
  const theme = deriveTheme(colors, overrides);
  const pairs: Array<[string, string, string, number]> = [
    ["ink", theme.ink, theme.bg, 4.5],
    ["ink on panel", theme.ink, theme.panel, 4.5],
    ["ink on card", theme.ink, theme.card, 4.5],
    ["muted on bg", theme.muted, theme.bg, 3],
    ["button text on accent", theme["on-accent"], theme.blue, 4.5],
    ["button text on highlight", theme["on-gold"], theme.gold, 4.5],
    ["accent2 on bg", theme.cyan, theme.bg, 3],
    ["highlight on bg", theme.gold, theme.bg, 3],
    ["white on danger button", "#ffffff", theme["danger-strong"], 3]
  ];
  return pairs
    .filter(([, foreground, background, minimum]) => contrastRatio(foreground, background) < minimum)
    .map(([name, foreground, background, minimum]) => `${name}: ${foreground} на ${background} даёт контраст ${contrastRatio(foreground, background).toFixed(2)} (< ${minimum})`);
}
