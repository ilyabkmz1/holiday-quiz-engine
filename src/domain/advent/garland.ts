/**
 * Гирлянда-шкала «Витрины»: огоньков столько же, сколько дней (до 16), дальше один огонёк — сегмент из нескольких дней.
 * Горит столько, сколько открыто (`streak.progress`, включая подаренный день); на месте ближайшей цели серии стоит значок подарка.
 */
export const GARLAND_MAX_BULBS = 16;

export type GarlandModel = {
  /** Число огоньков на проводе. */
  bulbs: number;
  /** Дней на один огонёк (1 при N ≤ 16). */
  perBulb: number;
  /** Сколько огоньков горит. */
  lit: number;
  /** Номер огонька (с 1) со значком подарка ближайшей цели; `null`, если целей не осталось. */
  goalBulb: number | null;
  /** Сколько огоньков осталось зажечь до цели; 0, если цель уже достигнута или её нет. */
  left: number;
};

export function garlandModel(totalDays: number, progress: number, nextGoalOpened: number | null): GarlandModel {
  const total = Math.max(1, Math.floor(totalDays));
  const perBulb = total <= GARLAND_MAX_BULBS ? 1 : Math.ceil(total / GARLAND_MAX_BULBS);
  const bulbs = Math.ceil(total / perBulb);
  const opened = Math.min(total, Math.max(0, Math.floor(progress)));
  // Сегмент загорается целиком, когда открыты все его дни; последний огонёк — только при полном прогрессе.
  const lit = Math.min(bulbs, Math.floor(opened / perBulb));
  const goalBulb = nextGoalOpened === null ? null : Math.min(bulbs, Math.max(1, Math.ceil(nextGoalOpened / perBulb)));
  const left = goalBulb === null ? 0 : Math.max(0, goalBulb - lit);
  return { bulbs, perBulb, lit, goalBulb, left };
}

/**
 * Точка провода на квадратичной кривой (провисание вниз): `t` от 0 до 1, ширина и провис в единицах viewBox.
 * Концы провода закреплены на высоте `top`, середина опускается на `sag`.
 */
export function wirePoint(t: number, width: number, top: number, sag: number): { x: number; y: number } {
  const x = t * width;
  // Парабола с вершиной посередине: y = top + 4·sag·t·(1 − t).
  return { x, y: top + 4 * sag * t * (1 - t) };
}

/** Позиции огоньков вдоль провода: равномерно по `t`, с отступом от краёв. */
export function bulbPositions(bulbs: number, width: number, top: number, sag: number, inset = 14): Array<{ x: number; y: number }> {
  return Array.from({ length: bulbs }, (_, index) => {
    const t = bulbs === 1 ? 0.5 : index / (bulbs - 1);
    const point = wirePoint(t, width - inset * 2, top, sag);
    return { x: point.x + inset, y: point.y };
  });
}

/** Склонение по числу: «1 огонёк», «2 огонька», «5 огоньков». */
export function pluralForm(count: number, forms: readonly [one: string, few: string, many: string]): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}
