import { describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";
import { appVersion } from "@/server/version";

describe("версия сборки", () => {
  it("по умолчанию dev", () => {
    expect(appVersion({})).toBe("dev");
    expect(appVersion({ APP_VERSION: "  " })).toBe("dev");
  });

  it("берёт APP_VERSION", () => {
    expect(appVersion({ APP_VERSION: "4e5a9d8" })).toBe("4e5a9d8");
  });

  it("GET /api/health отдаёт версию", async () => {
    vi.stubEnv("APP_VERSION", "abc1234");
    try {
      const body = await GET().json();
      expect(body).toEqual({ status: "ok", version: "abc1234" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
