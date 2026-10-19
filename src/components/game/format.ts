/** Секунды в `m:ss`. */
export function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function points(value: number): string {
  return value.toLocaleString("ru-RU").replace(/ /g, " ");
}

export function signed(value: number): string {
  return `+${points(value)}`;
}

/** Склонение: plural(2, "очко", "очка", "очков"). */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const NUMERALS = ["ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять"];

/** «пять комнат», «три комнаты»: число прописью (до 10) и существительное в нужной форме. */
export function countPhrase(count: number, one: string, few: string, many: string): string {
  return `${NUMERALS[count] ?? count} ${plural(count, one, few, many)}`;
}
