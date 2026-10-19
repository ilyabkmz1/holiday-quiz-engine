import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "@/server/rate-limit";
import { isSharePath, shareGate } from "@/server/share-gate";

const req = (pathname: string, ip?: string) => ({
  headers: new Headers(ip ? { "x-forwarded-for": `${ip}, 10.0.0.1` } : {}),
  nextUrl: { pathname }
});

describe("shareGate", () => {
  it("лимитирует только /share/*, включая нормализованные варианты пути", () => {
    for (const path of ["/share/abc", "/share/abc/image", "/Share/abc", "/%73hare/abc", "//share/abc"]) expect(isSharePath(path), path).toBe(true);
    for (const path of ["/", "/share", "/sharex/abc", "/api/sessions", "/admin", "/privacy"]) expect(isSharePath(path), path).toBe(false);
  });

  it("отвечает 429 после лимита, считает по IP и ничего не делает для других путей", () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000);
    for (let index = 0; index < 3; index += 1) expect(shareGate(req("/share/a", "1.1.1.1"), limiter)).toBeNull();
    const blocked = shareGate(req("/share/a/image", "1.1.1.1"), limiter);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("retry-after")).toBe("60");
    expect(shareGate(req("/share/a", "2.2.2.2"), limiter)).toBeNull();
    expect(shareGate(req("/api/sessions", "1.1.1.1"), limiter)).toBeNull();
  });
});
