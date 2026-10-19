import { describe, expect, it } from "vitest";

import { campaign } from "@tenants/demo-office/campaign";
import { InMemoryClaimRepository } from "@/server/repositories/in-memory-claim-repository";
import { InMemorySessionRepository } from "@/server/repositories/in-memory-session-repository";
import { ClaimService } from "@/server/services/claim-service";
import { RushService } from "@/server/services/rush-service";
import { SessionService } from "@/server/services/session-service";

import { correctPayload } from "../support/solve";

/** Полное прохождение: пять комнат, рывок без очков и финализация. */
async function completedSession(sessionService: SessionService, rushService: RushService) {
  const created = await sessionService.create();
  for (const room of campaign.rooms) {
    await sessionService.enterRoom(created.session.id, room.id);
    for (const task of room.tasks) {
      await sessionService.answerTask(created.session.id, task.id, correctPayload(task));
    }
  }
  await rushService.start(created.session.id);
  await rushService.finish(created.session.id);
  await sessionService.complete(created.session.id);
  return created.session.id;
}

describe("ClaimService", () => {
  it("creates one claim per normalized email and sends one verification", async () => {
    const sessions = new InMemorySessionRepository();
    const sessionService = new SessionService(sessions, campaign);
    const rushService = new RushService(sessions, sessionService, campaign);
    const claims = new InMemoryClaimRepository();
    const sentLinks: string[] = [];
    const service = new ClaimService({
      claims,
      sessions,
      campaign,
      now: () => new Date("2026-12-24T12:00:00Z"),
      sendVerification: async (_email, link) => { sentLinks.push(link); },
      verificationBaseUrl: "https://quiz.example/api/claims/verify"
    });
    const firstSession = await completedSession(sessionService, rushService);
    const secondSession = await completedSession(sessionService, rushService);

    const first = await service.create(firstSession, {
      name: "Иван",
      email: " IVAN@EXAMPLE.COM ",
      company: "Партнёр",
      consent: true
    });
    const retry = await service.create(secondSession, {
      name: "Другой Иван",
      email: "ivan@example.com",
      company: "Другая компания",
      consent: true
    });

    expect(first.claim.id).toBe(retry.claim.id);
    expect(first.claim.normalizedEmail).toBe("ivan@example.com");
    expect(sentLinks).toHaveLength(1);
    expect(new URL(sentLinks[0]).pathname).toBe("/api/claims/verify");
  });

  it("verifies a token once and treats a repeated click as already verified", async () => {
    const sessions = new InMemorySessionRepository();
    const sessionService = new SessionService(sessions, campaign);
    const rushService = new RushService(sessions, sessionService, campaign);
    const claims = new InMemoryClaimRepository();
    const links: string[] = [];
    const service = new ClaimService({
      claims,
      sessions,
      campaign,
      now: () => new Date("2026-12-24T12:00:00Z"),
      sendVerification: async (_email, link) => { links.push(link); },
      verificationBaseUrl: "https://quiz.example/api/claims/verify"
    });
    const sessionId = await completedSession(sessionService, rushService);
    await service.create(sessionId, {
      name: "Иван",
      email: "ivan@example.com",
      company: "Партнёр",
      consent: true
    });
    const token = new URL(links[0]).searchParams.get("token")!;

    const verified = await service.verify(token);
    const retry = await service.verify(token);

    expect(verified.status).toBe("email_verified");
    expect(retry).toEqual(verified);
  });

  it("reissues verification for the same pending claim when email delivery fails", async () => {
    const sessions = new InMemorySessionRepository();
    const sessionService = new SessionService(sessions, campaign);
    const rushService = new RushService(sessions, sessionService, campaign);
    const claims = new InMemoryClaimRepository();
    let attempts = 0;
    const service = new ClaimService({
      claims,
      sessions,
      campaign,
      now: () => new Date("2026-12-24T12:00:00Z"),
      sendVerification: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("SMTP unavailable");
      },
      verificationBaseUrl: "https://quiz.example/api/claims/verify"
    });
    const sessionId = await completedSession(sessionService, rushService);
    const input = {
      name: "Иван",
      email: "ivan@example.com",
      company: "Партнёр",
      consent: true
    } as const;

    await expect(service.create(sessionId, input)).rejects.toThrow("SMTP unavailable");
    const retry = await service.create(sessionId, input);

    expect(retry.created).toBe(false);
    expect(attempts).toBe(2);
  });

  it("atomically retries when claim and verification persistence is interrupted", async () => {
    const sessions = new InMemorySessionRepository();
    const sessionService = new SessionService(sessions, campaign);
    const rushService = new RushService(sessions, sessionService, campaign);
    const claims = new InMemoryClaimRepository();
    const originalPrepare = claims.prepareClaim.bind(claims);
    let saveAttempts = 0;
    claims.prepareClaim = async (claim, verification) => {
      saveAttempts += 1;
      if (saveAttempts === 1) throw new Error("database interrupted");
      return originalPrepare(claim, verification);
    };
    const service = new ClaimService({
      claims,
      sessions,
      campaign,
      now: () => new Date("2026-12-24T12:00:00Z"),
      sendVerification: async () => {},
      verificationBaseUrl: "https://quiz.example/api/claims/verify"
    });
    const sessionId = await completedSession(sessionService, rushService);
    const input = { name: "Иван", email: "ivan@example.com", company: "Партнёр", consent: true } as const;

    await expect(service.create(sessionId, input)).rejects.toThrow("database interrupted");
    const retry = await service.create(sessionId, input);

    expect(retry.created).toBe(true);
    expect(saveAttempts).toBe(2);
  });

  it("never sends a verification token to a replacement email for an existing session", async () => {
    const sessions = new InMemorySessionRepository();
    const sessionService = new SessionService(sessions, campaign);
    const rushService = new RushService(sessions, sessionService, campaign);
    const claims = new InMemoryClaimRepository();
    const recipients: string[] = [];
    const service = new ClaimService({
      claims,
      sessions,
      campaign,
      now: () => new Date("2026-12-24T12:00:00Z"),
      sendVerification: async (email) => { recipients.push(email); },
      verificationBaseUrl: "https://quiz.example/api/claims/verify"
    });
    const sessionId = await completedSession(sessionService, rushService);
    await service.create(sessionId, {
      name: "Иван", email: "original@example.com", company: "Партнёр", consent: true
    });

    await service.create(sessionId, {
      name: "Иван", email: "replacement@example.com", company: "Партнёр", consent: true
    });

    expect(recipients).toEqual(["original@example.com", "original@example.com"]);
  });
});
