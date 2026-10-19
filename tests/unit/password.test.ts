import { describe, expect, it } from "vitest";

import { dummyHash, generatePassword, hashPassword, needsRehash, verifyPassword } from "@/server/password";

describe("пароли операторов (scrypt)", () => {
  it("хеш не содержит пароля, соль случайна, проверка верна и неверна", async () => {
    const password = generatePassword();
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(first).not.toContain(password);
    expect(first).not.toBe(second);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(`${password}x`, first)).toBe(false);
    expect(await verifyPassword("", first)).toBe(false);
  });

  it("испорченный или чужой формат хеша — «не совпало», без исключения", async () => {
    for (const stored of ["", "plain", "scrypt$1$2", "bcrypt$1$1$1$a$b", "scrypt$x$8$1$a$b", "scrypt$99999999$8$1$YQ==$YQ==", "scrypt$32768$8$1$$"]) {
      expect(await verifyPassword("anything-long-enough", stored), stored).toBe(false);
    }
  });

  it("параметры хранятся в хеше: старый хеш проверяется, а needsRehash подсказывает обновление", async () => {
    const stored = await hashPassword("old-parameters-password");
    expect(needsRehash(stored)).toBe(false);
    const weaker = await hashPassword("old-parameters-password", { N: 2 ** 14 });
    expect(needsRehash(weaker)).toBe(true);
    expect(await verifyPassword("old-parameters-password", weaker)).toBe(true);
  });

  it("generatePassword даёт длинные разные пароли; dummyHash — рабочий хеш", async () => {
    expect(generatePassword().length).toBeGreaterThanOrEqual(24);
    expect(generatePassword()).not.toBe(generatePassword());
    expect(await dummyHash()).toMatch(/^scrypt\$/);
  });
});
