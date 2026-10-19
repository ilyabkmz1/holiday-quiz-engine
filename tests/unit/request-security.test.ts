import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "@/server/rate-limit";
import { isAllowedOrigin, isSameOriginRequest, verifySessionAccess } from "@/server/request-security";
import { hashToken } from "@/server/crypto";

describe("request security", () => {
  it("allows only the configured origin", () => {
    expect(isAllowedOrigin("https://quiz.example", "https://quiz.example")).toBe(true);
    expect(isAllowedOrigin("https://evil.example", "https://quiz.example")).toBe(false);
    expect(isAllowedOrigin(null, "https://quiz.example")).toBe(false);
  });

  it("treats a request as same-origin only with matching Origin and a non-cross-site Sec-Fetch-Site", () => {
    const app = "https://quiz.example";
    const h = (init: Record<string, string>) => new Headers(init);
    expect(isSameOriginRequest(h({ origin: app }), app)).toBe(true);
    expect(isSameOriginRequest(h({ origin: app, "sec-fetch-site": "same-origin" }), app)).toBe(true);
    expect(isSameOriginRequest(h({}), app)).toBe(false);
    expect(isSameOriginRequest(h({ origin: "https://evil.example" }), app)).toBe(false);
    for (const site of ["cross-site", "same-site", "none"]) {
      expect(isSameOriginRequest(h({ origin: app, "sec-fetch-site": site }), app), site).toBe(false);
    }
  });

  it("checks the raw session key against its stored hash", () => {
    expect(verifySessionAccess("secret", hashToken("secret"))).toBe(true);
    expect(verifySessionAccess("wrong", hashToken("secret"))).toBe(false);
  });
});

describe("FixedWindowRateLimiter", () => {
  it("blocks requests after the configured limit and resets in the next window", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(2, 1_000, () => now);

    expect(limiter.allow("ip")).toBe(true);
    expect(limiter.allow("ip")).toBe(true);
    expect(limiter.allow("ip")).toBe(false);
    now = 2_001;
    expect(limiter.allow("ip")).toBe(true);
  });
});
