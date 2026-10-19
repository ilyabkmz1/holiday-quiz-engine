export type LuckPoolItem = { rewardId: string; weight: number };

/**
 * Остаток призов: `rewardId` → сколько осталось. Нет ключа — приз без лимита; `0` — приз закончился.
 */
export type StockLeft = Readonly<Record<string, number | undefined>>;

/** xmur3: превращает строку в 32-битное число с хорошим перемешиванием (без `node:crypto`, домен чистый). */
function hashString(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    h = Math.imul(h ^ text.charCodeAt(index), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32: из 32-битного зерна — равномерное число в [0, 1). */
function unit(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Зерно розыгрыша: одно и то же для (кампания, участник, день), поэтому повторный запрос даёт тот же результат. */
export function luckSeed(campaignSlug: string, participantId: string, day: number): number {
  return hashString(`${campaignSlug}\u0000${participantId}\u0000${day}`);
}

/**
 * Детерминированный выбор приза по весам среди призов с остатком (нет в `stockLeft` — без лимита, `0` — закончился).
 * Если подходящих нет, возвращает `fallbackRewardId`. Приз с остатком 0 не выдаётся никогда (утешительный приз
 * должен быть без лимита: это проверяет схема). Одинаковые входные данные дают одинаковый результат.
 *
 * `fallbackRewardId` в схеме необязателен (`luck.fallbackRewardId`): без него гарантию даёт приз пула без `stock`.
 * Если при этом подходящих призов нет, данные об остатках противоречат пакету — функция бросает ошибку.
 */
export function drawLuck(
  pool: readonly LuckPoolItem[],
  stockLeft: StockLeft,
  seed: number,
  fallbackRewardId: string | undefined
): string {
  const available = pool.filter((item) => item.weight > 0 && (stockLeft[item.rewardId] ?? Infinity) > 0);
  const total = available.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) {
    if (fallbackRewardId === undefined) throw new Error("В пуле удачи закончились призы, а утешительный приз не задан");
    return fallbackRewardId;
  }
  let point = unit(seed) * total;
  for (const item of available) {
    if (point < item.weight) return item.rewardId;
    point -= item.weight;
  }
  return available[available.length - 1].rewardId;
}
