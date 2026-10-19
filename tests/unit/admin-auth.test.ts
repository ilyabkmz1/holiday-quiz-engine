import { describe, expect, it, vi } from "vitest";

import { authenticateAdmin, processAdminAllowed, type AdminAuthDeps } from "@/server/admin-auth";
import { hashPassword } from "@/server/password";

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
const env = { ADMIN_USERNAME: "root", ADMIN_PASSWORD: "process-admin-password-16" };

async function deps(overrides: Partial<AdminAuthDeps> = {}): Promise<AdminAuthDeps> {
  const hashes = new Map<string, string>([
    ["alpha:anna", await hashPassword("anna-password-for-alpha-1")],
    ["beta:boris", await hashPassword("boris-password-for-beta-1")]
  ]);
  return {
    tenantSlug: "alpha",
    env,
    findAdmin: async (tenant, username) => {
      const passwordHash = hashes.get(`${tenant}:${username}`);
      return passwordHash ? { passwordHash, disabledAt: null } : null;
    },
    ...overrides
  };
}

describe("authenticateAdmin: админка строго в рамках арендатора", () => {
  it("оператор арендатора входит на своём арендаторе", async () => {
    expect(await authenticateAdmin(basic("anna", "anna-password-for-alpha-1"), await deps())).toBe("tenant");
  });

  it("логин другого арендатора на этом не работает, даже с верным паролем (подмена Host доступа не даёт)", async () => {
    expect(await authenticateAdmin(basic("boris", "boris-password-for-beta-1"), await deps())).toBeNull();
    expect(await authenticateAdmin(basic("boris", "boris-password-for-beta-1"), await deps({ tenantSlug: "beta" }))).toBe("tenant");
    expect(await authenticateAdmin(basic("anna", "anna-password-for-alpha-1"), await deps({ tenantSlug: "beta" }))).toBeNull();
  });

  it("неверный пароль, пустой заголовок, не-Basic схема, отключённый логин — отказ", async () => {
    const base = await deps();
    for (const authorization of [null, "", "Bearer x", basic("anna", "wrong-password-for-alpha"), basic("anna", ""), basic("", "")]) {
      expect(await authenticateAdmin(authorization, base), String(authorization)).toBeNull();
    }
    const disabled = await deps({ findAdmin: async () => ({ passwordHash: await hashPassword("anna-password-for-alpha-1"), disabledAt: new Date() }) });
    expect(await authenticateAdmin(basic("anna", "anna-password-for-alpha-1"), disabled)).toBeNull();
  });

  it("недоступная база — отказ, в журнал уходит только событие без секретов", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const broken = await deps({ findAdmin: async () => { throw new Error("connect ECONNREFUSED postgresql://user:secret@db"); } });
      expect(await authenticateAdmin(basic("anna", "anna-password-for-alpha-1"), broken)).toBeNull();
      const logged = error.mock.calls.flat().join(" ");
      expect(logged).toContain("admin_auth_lookup_failed");
      expect(logged).not.toContain("secret");
      expect(logged).not.toContain("anna");
    } finally {
      error.mockRestore();
    }
  });

  it("администратор из окружения: только при TENANT или явном SUPERADMIN, иначе общий пароль не работает", async () => {
    const creds = basic("root", env.ADMIN_PASSWORD);
    expect(processAdminAllowed({})).toBe(false);
    expect(await authenticateAdmin(creds, await deps())).toBeNull();
    expect(await authenticateAdmin(creds, await deps({ env: { ...env, TENANT: "alpha" } }))).toBe("process");
    expect(await authenticateAdmin(creds, await deps({ env: { ...env, SUPERADMIN: true } }))).toBe("process");
    expect(await authenticateAdmin(basic("root", "wrong-process-password-16"), await deps({ env: { ...env, SUPERADMIN: true } }))).toBeNull();
  });

  it("хеш со старыми параметрами принимается и пересчитывается при входе", async () => {
    const weak = await hashPassword("anna-password-for-alpha-1", { N: 2 ** 14 });
    const onRehash = vi.fn(async () => undefined);
    const current = await deps({ onRehash, findAdmin: async () => ({ passwordHash: weak, disabledAt: null }) });
    expect(await authenticateAdmin(basic("anna", "anna-password-for-alpha-1"), current)).toBe("tenant");
    expect(onRehash).toHaveBeenCalledWith("alpha", "anna", "anna-password-for-alpha-1");
  });
});
