import { describe, expect, it } from "vitest";

import { getPrisma } from "@/server/db";

import {
  adminClaimsCsv,
  adminClaimsExport,
  adminHeaders,
  adminMetrics,
  api,
  completedPlayer,
  installFakes,
  makeRequest,
  markClaimsExported,
  PERFECT_FIXED_CLOCK_SCORE,
  startSession,
  verifiedClaim
} from "./helpers/app";
import { TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME } from "./helpers/constants";
import { sensitiveValues } from "./helpers/leak-guard";

const wrongPassword = "x".repeat(24);

describe.each([
  ["metrics", () => adminMetrics, "/api/admin/metrics"],
  ["claims.csv", () => adminClaimsCsv, "/api/admin/claims.csv"]
] as const)("admin auth: %s", (_name, handler, path) => {
  it("answers 401 with a Basic challenge when credentials are missing", async () => {
    const response = await handler()(makeRequest(path));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/^Basic /);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 401 for a wrong password, a wrong user and non-Basic schemes", async () => {
    sensitiveValues.add(wrongPassword);
    const attempts = [
      adminHeaders(wrongPassword),
      adminHeaders(TEST_ADMIN_PASSWORD, "intruder"),
      adminHeaders(TEST_ADMIN_PASSWORD.slice(0, -1)),
      { authorization: `Bearer ${TEST_ADMIN_PASSWORD}` },
      { authorization: "Basic !!!not-base64" },
      { authorization: `Basic ${Buffer.from(TEST_ADMIN_USERNAME).toString("base64")}` }
    ];
    for (const headers of attempts) {
      const response = await handler()(makeRequest(path, { headers }));
      expect(response.status).toBe(401);
    }
  });

  it("accepts correct credentials", async () => {
    const response = await handler()(makeRequest(path, { headers: adminHeaders() }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/admin/metrics", () => {
  it("returns aggregates for started, completed, verified and failed emails", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "one@example.com" });
    await completedPlayer(); // завершил, но без заявки
    await startSession(); // только начал
    mailer.failNext = 1;
    const failing = await completedPlayer();
    await api.claim(failing.sessionId, failing.accessKey, {
      name: "Пётр Иванов", email: "fail@example.com", company: "Компания", consent: true
    });

    const response = await adminMetrics(makeRequest("/api/admin/metrics", { headers: adminHeaders() }));

    expect(await response.json()).toEqual({
      campaign: "demo-office-new-year-2026",
      started: 4,
      completed: 3,
      verified: 1,
      emailFailures: 1
    });
  });

  it("returns zeros on an empty database", async () => {
    const response = await adminMetrics(makeRequest("/api/admin/metrics", { headers: adminHeaders() }));

    expect(await response.json()).toMatchObject({ started: 0, completed: 0, verified: 0, emailFailures: 0 });
  });
});

describe("GET /api/admin/claims.csv", () => {
  async function csv(): Promise<{ text: string; response: Response; bytes: Buffer }> {
    const response = await adminClaimsCsv(makeRequest("/api/admin/claims.csv", { headers: adminHeaders() }));
    const bytes = Buffer.from(await response.arrayBuffer());
    return { text: bytes.toString("utf8"), response, bytes };
  }

  it("exports only confirmed claims and does not change their status (GET is read-only)", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "confirmed@example.com", name: "Подтверждённый", company: "Альфа" });
    const pending = await completedPlayer();
    await api.claim(pending.sessionId, pending.accessKey, {
      name: "Неподтверждённый", email: "pending@example.com", company: "Бета", consent: true
    });

    const { text, response, bytes } = await csv();

    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain("confirmed@example.com");
    expect(text).toContain("Подтверждённый");
    expect(text).not.toContain("pending@example.com");
    expect(text).not.toContain("Неподтверждённый");

    const statuses = Object.fromEntries(
      (await getPrisma().prizeClaim.findMany()).map((claim) => [claim.normalizedEmail, claim.status])
    );
    expect(statuses).toEqual({ "confirmed@example.com": "email_verified", "pending@example.com": "claim_pending" });
    expect((await getPrisma().prizeClaim.findFirstOrThrow({ where: { status: "email_verified" } })).exportedAt).toBeNull();
  });

  it("repeats already exported claims on the next download", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "confirmed@example.com" });

    const first = await csv();
    await markClaimsExported();
    const second = await csv();

    expect(second.text).toBe(first.text);
    expect((await getPrisma().prizeClaim.findFirstOrThrow()).status).toBe("exported");
  });

  it("includes score and reward tier from the server-side session result", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "confirmed@example.com" });

    const { text } = await csv();

    expect(text).toContain(`"${PERFECT_FIXED_CLOCK_SCORE}"`);
    expect(text).toContain("Душа «Северного офиса»");
  });

  it("neutralizes spreadsheet formulas in user-controlled cells", async () => {
    const mailer = installFakes();
    const payloads = ["=HYPERLINK(1)", "+SUM(1)", "-2+3", "@SUM(A1)"];
    for (const [index, payload] of payloads.entries()) {
      await verifiedClaim(mailer, { email: `formula${index}@example.com`, name: payload, company: payload });
    }

    const { text } = await csv();

    for (const payload of payloads) {
      expect(text).toContain(`"'${payload}"`);
      expect(text).not.toContain(`"${payload}"`);
    }
  });

  it("escapes quotes and keeps commas and line breaks inside one cell", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "quote@example.com", name: 'Иван "Ваня", Петров', company: "Строка1\nСтрока2" });

    const { text } = await csv();

    expect(text).toContain('"Иван ""Ваня"", Петров"');
    expect(text).toContain('"Строка1\nСтрока2"');
  });

  it("returns only the header for an empty database", async () => {
    const { text } = await csv();

    expect(text.trim().split("\r\n")).toHaveLength(1);
  });
});

describe("POST /api/admin/claims/export", () => {
  const post = (headers: Record<string, string>, origin?: string | null) =>
    adminClaimsExport(makeRequest("/api/admin/claims/export", { method: "POST", headers, origin }));
  const statuses = async () =>
    Object.fromEntries((await getPrisma().prizeClaim.findMany()).map((claim) => [claim.normalizedEmail, claim.status]));

  it("requires ADMIN credentials", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "confirmed@example.com" });

    expect((await post({})).status).toBe(401);
    expect((await post(adminHeaders(wrongPassword))).status).toBe(401);
    expect(await statuses()).toEqual({ "confirmed@example.com": "email_verified" });
  });

  it("marks only confirmed claims as exported and stores the export date", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "confirmed@example.com" });
    const pending = await completedPlayer();
    await api.claim(pending.sessionId, pending.accessKey, {
      name: "Неподтверждённый", email: "pending@example.com", company: "Бета", consent: true
    });

    const response = await markClaimsExported();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ exported: 1 });
    expect(await statuses()).toEqual({ "confirmed@example.com": "exported", "pending@example.com": "claim_pending" });
    expect((await getPrisma().prizeClaim.findFirstOrThrow({ where: { status: "exported" } })).exportedAt).not.toBeNull();
    expect(await (await markClaimsExported()).json()).toEqual({ exported: 0 });
  });

  it("rejects requests without a same-origin Origin or with a cross-site Sec-Fetch-Site (CSRF)", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer, { email: "confirmed@example.com" });

    expect((await post(adminHeaders(), null)).status).toBe(403);
    expect((await post(adminHeaders(), "https://evil.example")).status).toBe(403);
    expect((await post({ ...adminHeaders(), "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ ...adminHeaders(), "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await post({ ...adminHeaders(), "sec-fetch-site": "none" })).status).toBe(403);
    expect(await statuses()).toEqual({ "confirmed@example.com": "email_verified" });

    expect((await post({ ...adminHeaders(), "sec-fetch-site": "same-origin" })).status).toBe(200);
  });
});
