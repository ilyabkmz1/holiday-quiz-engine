import { describe, expect, it } from "vitest";

import { campaignPhase, verificationTokenExpiresAt } from "@/domain/window";

const campaign = {
  startsAt: "2026-12-20T00:00:00+03:00",
  claimEndsAt: "2026-12-31T23:59:59+03:00",
  verificationEndsAt: "2027-01-02T23:59:59+03:00"
};

describe("campaignPhase", () => {
  it("uses the campaign's offset-aware boundaries", () => {
    expect(campaignPhase(new Date("2026-12-19T20:59:59Z"), campaign)).toBe("upcoming");
    expect(campaignPhase(new Date("2026-12-19T21:00:00Z"), campaign)).toBe("open");
    expect(campaignPhase(new Date("2026-12-31T21:00:00Z"), campaign)).toBe("claim_closed");
    expect(campaignPhase(new Date("2027-01-02T21:00:00Z"), campaign)).toBe("verification_closed");
  });
});

describe("verificationTokenExpiresAt", () => {
  it("expires in 24 hours but never after the campaign verification deadline", () => {
    expect(
      verificationTokenExpiresAt(new Date("2026-12-25T10:00:00Z"), campaign).toISOString()
    ).toBe("2026-12-26T10:00:00.000Z");
    expect(
      verificationTokenExpiresAt(new Date("2027-01-02T19:30:00Z"), campaign).toISOString()
    ).toBe("2027-01-02T20:59:59.000Z");
  });
});
