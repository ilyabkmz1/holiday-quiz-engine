import { describe, expect, it } from "vitest";

import { verifyBasicAuth } from "@/server/auth";
import { claimsToCsv } from "@/server/csv";

describe("verifyBasicAuth", () => {
  it("accepts only the configured Basic credentials", () => {
    const valid = `Basic ${Buffer.from("operator:secret").toString("base64")}`;
    const invalid = `Basic ${Buffer.from("operator:wrong").toString("base64")}`;

    expect(verifyBasicAuth(valid, "operator", "secret")).toBe(true);
    expect(verifyBasicAuth(invalid, "operator", "secret")).toBe(false);
    expect(verifyBasicAuth(null, "operator", "secret")).toBe(false);
  });
});

describe("claimsToCsv", () => {
  it("exports verified claims and neutralizes spreadsheet formulas", () => {
    const csv = claimsToCsv([
      {
        name: "=HYPERLINK(\"https://evil\")",
        normalizedEmail: "user@example.com",
        company: "+SUM(1,1)",
        score: 900,
        rewardTierTitle: "Душа «Северного офиса»",
        verifiedAt: new Date("2026-12-25T10:00:00Z")
      }
    ]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("'=" );
    expect(csv).toContain("'+SUM(1,1)");
    expect(csv).not.toContain("\n=HYPERLINK");
  });
});
