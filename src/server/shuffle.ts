import { createHash } from "node:crypto";

/** Генератор mulberry32: детерминированная последовательность чисел в [0, 1) из 32-битного зерна. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(seed: string): number {
  return createHash("sha256").update(seed).digest().readUInt32BE(0);
}

/**
 * Перемешивание Фишера — Йетса с зерном: один и тот же `seed` всегда даёт один и тот же порядок
 * (восстановление игры и повторный запрос показывают задание одинаково), разные — разный.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  const random = mulberry32(seedOf(seed));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
