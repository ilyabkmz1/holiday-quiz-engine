import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt из node:crypto: без внешних зависимостей. Параметры в самом хеше, поэтому их можно усилить без миграции данных:
// старые строки проверяются со своими параметрами, а `needsRehash` подсказывает, когда обновить.
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keyLength: 64, saltLength: 16 } as const;
const PREFIX = "scrypt";

const derive = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

// scrypt с N=2^15 требует 32 МиБ при r=8; лимит памяти Node по умолчанию (32 МиБ) ниже, поэтому поднимаем явно.
const memoryLimit = (N: number, r: number) => 128 * N * r * 2;

/** Хеш пароля формата `scrypt$N$r$p$соль(base64)$ключ(base64)`. */
export async function hashPassword(password: string, cost: { N?: number } = {}): Promise<string> {
  const N = cost.N ?? PARAMS.N;
  const salt = randomBytes(PARAMS.saltLength);
  const key = await derive(password, salt, PARAMS.keyLength, { N, r: PARAMS.r, p: PARAMS.p, maxmem: memoryLimit(N, PARAMS.r) });
  return [PREFIX, N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Проверка пароля по хешу; любой неразборчивый хеш — «не совпало», а не исключение. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, n, r, p, salt, key] = stored.split("$");
  if (prefix !== PREFIX || !salt || !key) return false;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every((value) => Number.isInteger(value) && value > 0) || N > 2 ** 20 || R > 16 || P > 4) return false;
  const expected = Buffer.from(key, "base64");
  if (expected.length === 0) return false;
  try {
    const actual = await derive(password, Buffer.from(salt, "base64"), expected.length, { N, r: R, p: P, maxmem: memoryLimit(N, R) });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Хеш с текущими параметрами нужно пересчитать при следующем входе. */
export function needsRehash(stored: string): boolean {
  const [prefix, n, r, p] = stored.split("$");
  return prefix !== PREFIX || Number(n) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p;
}

/** Хеш нерабочего пароля для сравнения, когда логина нет: время ответа не выдаёт, существует ли пользователь. */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword(randomBytes(16).toString("hex")));

/** Случайный пароль для нового логина (показывается один раз, в БД попадает хешем). */
export const generatePassword = (): string => randomBytes(18).toString("base64url");
