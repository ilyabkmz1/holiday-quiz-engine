/** Приз дороже этой суммы облагается НДФЛ 35%: `quiz:check` предупреждает владельца. */
export const NDFL_THRESHOLD_RUB = 4000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Алфавит Crockford base32 без I, L, O, U: символы не путаются на кассе и при диктовке. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Момент окончания действия награды: `validDays` суток с момента выдачи; без срока — `null`. */
export function rewardExpiresAt(grantedAt: Date, reward: { validDays?: number | null }): Date | null {
  if (reward.validDays == null) return null;
  return new Date(grantedAt.getTime() + reward.validDays * DAY_MS);
}

export function isOverNdflThreshold(reward: { valueRub?: number | null }): boolean {
  return (reward.valueRub ?? 0) > NDFL_THRESHOLD_RUB;
}

/**
 * Код награды: `prefix` и `length` символов Crockford base32. `rng` возвращает число в [0, 1);
 * в рантайме сюда передаётся криптостойкий источник, в тестах — детерминированный.
 */
export function generateRewardCode(prefix: string, length: number, rng: () => number): string {
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.floor(rng() * CODE_ALPHABET.length))];
  }
  return `${prefix}${code}`;
}
