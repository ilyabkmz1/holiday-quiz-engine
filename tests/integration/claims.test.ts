import { describe, expect, it } from "vitest";

import { hashToken } from "@/server/crypto";
import { getPrisma } from "@/server/db";

import {
  adminMetrics,
  adminHeaders,
  api,
  claimInput,
  completedPlayer,
  installFakes,
  json,
  makeRequest,
  startSession,
  verifiedClaim
} from "./helpers/app";
import { OPEN_NOW, TEST_APP_URL } from "./helpers/constants";

function redirectTarget(response: Response): string {
  return new URL(response.headers.get("location")!, TEST_APP_URL).pathname +
    new URL(response.headers.get("location")!, TEST_APP_URL).search;
}

describe("claim + verify", () => {
  it("runs the full path: claim → email → verify → confirmed", async () => {
    const mailer = installFakes();
    const player = await completedPlayer();
    const input = claimInput();

    const claim = await api.claim(player.sessionId, player.accessKey, input);

    expect(claim.status).toBe(200);
    expect(await json(claim)).toEqual({ status: "claim_pending", created: true });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].email).toBe("maria.test@example.com");
    expect(mailer.sent[0].link.startsWith(`${TEST_APP_URL}/api/claims/verify?token=`)).toBe(true);

    const stored = await getPrisma().prizeClaim.findFirstOrThrow({ include: { verification: true } });
    expect(stored.status).toBe("claim_pending");
    expect(stored.normalizedEmail).toBe("maria.test@example.com");
    expect(stored.verifiedAt).toBeNull();

    const verify = await api.verify(mailer.sent[0].token);
    expect(verify.status).toBe(307);
    expect(redirectTarget(verify)).toBe("/verify?status=success");

    const confirmed = await getPrisma().prizeClaim.findFirstOrThrow({ include: { verification: true } });
    expect(confirmed.status).toBe("email_verified");
    expect(confirmed.verifiedAt).toEqual(OPEN_NOW);
    expect(confirmed.verification?.usedAt).toEqual(OPEN_NOW);
  });

  it("stores the verification token only as a hash", async () => {
    const mailer = installFakes();
    const player = await completedPlayer();
    await api.claim(player.sessionId, player.accessKey, claimInput());
    const token = mailer.sent[0].token;

    const verification = await getPrisma().emailVerification.findFirstOrThrow();
    const everything = JSON.stringify({
      verifications: await getPrisma().emailVerification.findMany(),
      claims: await getPrisma().prizeClaim.findMany(),
      sessions: await getPrisma().gameSession.findMany(),
      audit: await getPrisma().auditEvent.findMany()
    });

    expect(verification.tokenHash).toBe(hashToken(token));
    expect(everything).not.toContain(token);
    // Ключ доступа сессии тоже лежит в БД только хешем.
    expect(everything).not.toContain(player.accessKey);
  });

  it("redirects to the error page for missing, malformed and unknown tokens", async () => {
    installFakes();
    for (const token of [null, "", "short", "x".repeat(40), "x".repeat(300)]) {
      const response = await api.verify(token);
      expect(response.status).toBe(307);
      expect(redirectTarget(response)).toBe("/verify?status=error");
    }
  });

  it("rejects an expired token and leaves the claim pending", async () => {
    const mailer = installFakes(OPEN_NOW);
    const player = await completedPlayer();
    await api.claim(player.sessionId, player.accessKey, claimInput());
    installFakes(new Date(OPEN_NOW.getTime() + 24 * 60 * 60 * 1000 + 1000));

    const response = await api.verify(mailer.sent[0].token);

    expect(redirectTarget(response)).toBe("/verify?status=error");
    expect((await getPrisma().prizeClaim.findFirstOrThrow()).status).toBe("claim_pending");
  });

  it("rejects verification after the verification period closed", async () => {
    const mailer = installFakes(OPEN_NOW);
    const player = await completedPlayer();
    await api.claim(player.sessionId, player.accessKey, claimInput());
    installFakes(new Date("2027-01-03T12:00:00Z"));

    const response = await api.verify(mailer.sent[0].token);

    expect(redirectTarget(response)).toBe("/verify?status=error");
    expect((await getPrisma().prizeClaim.findFirstOrThrow()).status).toBe("claim_pending");
  });

  it("does not re-apply a used token: state set later (exported) is preserved", async () => {
    const mailer = installFakes();
    await verifiedClaim(mailer);
    await getPrisma().prizeClaim.updateMany({ data: { status: "exported" } });
    const before = await getPrisma().prizeClaim.findFirstOrThrow();

    const again = await api.verify(mailer.sent[0].token);

    expect(redirectTarget(again)).toBe("/verify?status=success");
    expect(await getPrisma().prizeClaim.findFirstOrThrow()).toEqual(before);
  });

  it("invalidates the previous token when the same session retries a pending claim", async () => {
    const mailer = installFakes();
    mailer.failNext = 1;
    const player = await completedPlayer();
    const input = claimInput();

    const failed = await api.claim(player.sessionId, player.accessKey, input);
    const retried = await api.claim(player.sessionId, player.accessKey, input);

    expect(failed.status).toBe(500);
    expect(retried.status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(await getPrisma().prizeClaim.count()).toBe(1);
    expect(redirectTarget(await api.verify(mailer.sent[0].token))).toBe("/verify?status=success");
  });

  it("records an audit event and hides details when email delivery fails", async () => {
    const mailer = installFakes();
    mailer.failNext = 1;
    const player = await completedPlayer();
    const input = claimInput();

    const response = await api.claim(player.sessionId, player.accessKey, input);
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("Не удалось выполнить запрос.");
    expect(JSON.stringify(body)).not.toMatch(/SMTP|@/);
    const claim = await getPrisma().prizeClaim.findFirstOrThrow();
    const events = await getPrisma().auditEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "verification_email_failed", entityId: claim.id });
    expect(JSON.stringify(events)).not.toContain("maria.test");

    const metrics = await json(await adminMetrics(makeRequest("/api/admin/metrics", { headers: adminHeaders() })));
    expect(metrics.emailFailures).toBe(1);
  });

  it("does not let a second session confirm an already claimed email (case-insensitive)", async () => {
    const mailer = installFakes();
    const first = await completedPlayer();
    const second = await completedPlayer();

    const a = await api.claim(first.sessionId, first.accessKey, claimInput({ email: "same@example.com" }));
    const b = await api.claim(second.sessionId, second.accessKey, claimInput({ email: "SAME@Example.com" }));

    expect((await json(a)).created).toBe(true);
    expect((await json(b)).created).toBe(false);
    expect(mailer.sent).toHaveLength(1);
    expect(await getPrisma().prizeClaim.count()).toBe(1);
  });

  it("lets exactly one of two parallel claims for the same email succeed", async () => {
    const mailer = installFakes();
    const first = await completedPlayer();
    const second = await completedPlayer();
    const input = claimInput({ email: "race@example.com" });

    const responses = await Promise.all([
      api.claim(first.sessionId, first.accessKey, input),
      api.claim(second.sessionId, second.accessKey, { ...input, email: "RACE@example.com" })
    ]);
    const bodies = await Promise.all(responses.map(json));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(bodies.filter((body) => body.created)).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
    expect(await getPrisma().prizeClaim.count()).toBe(1);
    expect(await getPrisma().emailVerification.count()).toBe(1);
  });

  it("keeps one claim and one valid token when the same session double-submits", async () => {
    const mailer = installFakes();
    const player = await completedPlayer();
    const input = claimInput();

    const responses = await Promise.all([
      api.claim(player.sessionId, player.accessKey, input),
      api.claim(player.sessionId, player.accessKey, input)
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await getPrisma().prizeClaim.count()).toBe(1);
    const valid = await getPrisma().emailVerification.findFirstOrThrow();
    expect(mailer.sent.map((mail) => hashToken(mail.token))).toContain(valid.tokenHash);
  });

  it("validates the claim form without leaking the submitted values", async () => {
    installFakes();
    const player = await completedPlayer();
    const base = claimInput();

    const cases = [
      { ...base, consent: false },
      { ...base, email: "not-an-email" },
      { ...base, name: "A" },
      { ...base, company: " " },
      { name: base.name }
    ];
    for (const body of cases) {
      const response = await api.claim(player.sessionId, player.accessKey, body);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await json(response))).not.toContain(base.name);
    }
    expect(await getPrisma().prizeClaim.count()).toBe(0);
  });

  it("requires a completed session", async () => {
    installFakes();
    const player = await startSession();

    const response = await api.claim(player.sessionId, player.accessKey, claimInput());

    expect(response.status).toBe(409);
    expect(await getPrisma().prizeClaim.count()).toBe(0);
  });

  it("refuses new claims after the claim window closed", async () => {
    installFakes(OPEN_NOW);
    const player = await completedPlayer();
    installFakes(new Date("2027-01-01T12:00:00Z"));

    const response = await api.claim(player.sessionId, player.accessKey, claimInput());

    expect(response.status).toBe(409);
    expect(await getPrisma().prizeClaim.count()).toBe(0);
  });
});
