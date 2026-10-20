import { contrastRatio, mix } from "@/domain/color";

const PAPER = "#ffffff";
const INK = "#15171c";

/**
 * Цвета печатного отчёта: белая бумага, тёмный текст и акцент бренда клиента. Акцент затемняется до контраста не меньше
 * 4,5:1 с бумагой (текст) — тогда он годится и для столбцов графиков (нужно 3:1). Слишком светлый акцент (жёлтый) не пропадёт.
 */
export function reportPaperTheme(accent: string): { paper: string; ink: string; muted: string; accent: string; line: string } {
  let tone = accent;
  for (let step = 1; step <= 20 && contrastRatio(tone, PAPER) < 4.5; step += 1) tone = mix(accent, INK, step * 0.05);
  return { paper: PAPER, ink: INK, muted: "#4a5160", accent: tone, line: "#d5d9e0" };
}
