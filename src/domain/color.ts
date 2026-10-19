/** Цвет в формате #RRGGBB → компоненты 0–255. */
export function parseHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export function toHex([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue].map((part) => Math.round(Math.min(255, Math.max(0, part))).toString(16).padStart(2, "0")).join("")}`;
}

/** Смешивание: `amount` — доля `to` (0–1). */
export function mix(from: string, to: string, amount: number): string {
  const [fr, fg, fb] = parseHex(from);
  const [tr, tg, tb] = parseHex(to);
  return toHex([fr + (tr - fr) * amount, fg + (tg - fg) * amount, fb + (tb - fb) * amount]);
}

/** Относительная яркость по WCAG 2.x. */
export function luminance(hex: string): number {
  const [red, green, blue] = parseHex(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Коэффициент контраста WCAG (1–21). */
export function contrastRatio(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Какой из цветов читается на фоне лучше. */
export function readableOn(background: string, candidates: string[]): string {
  return candidates.reduce((best, candidate) => (contrastRatio(background, candidate) > contrastRatio(background, best) ? candidate : best));
}
