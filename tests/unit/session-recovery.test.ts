import { describe, expect, it } from "vitest";

import { shouldForgetSession } from "@/domain/session-recovery";

describe("session recovery", () => {
  it("forgets only sessions that are authoritatively unavailable", () => {
    expect(shouldForgetSession(401)).toBe(true);
    expect(shouldForgetSession(404)).toBe(true);
    expect(shouldForgetSession(429)).toBe(false);
    expect(shouldForgetSession(500)).toBe(false);
    expect(shouldForgetSession(undefined)).toBe(false);
  });
});
