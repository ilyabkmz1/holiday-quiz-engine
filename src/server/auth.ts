import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function verifyBasicAuth(
  authorization: string | null,
  expectedUsername: string,
  expectedPassword: string
): boolean {
  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return false;
  }
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  // Побитовое &, а не &&: обе проверки считаются всегда, по времени ответа нельзя понять, верен ли логин.
  const usernameMatches = timingSafeEqual(digest(username), digest(expectedUsername));
  const passwordMatches = timingSafeEqual(digest(password), digest(expectedPassword));
  return Boolean(Number(usernameMatches) & Number(passwordMatches));
}

/** Логин и пароль из заголовка `Authorization: Basic …`; `null`, если заголовка нет или он испорчен. */
export function parseBasicAuth(authorization: string | null): { username: string; password: string } | null {
  if (!authorization?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}
