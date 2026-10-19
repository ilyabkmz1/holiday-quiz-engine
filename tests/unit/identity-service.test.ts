import { afterEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "@/server/crypto";
import { AdventService } from "@/server/services/advent-service";
import { IdentityService, LOGIN_TOKEN_TTL_MS } from "@/server/services/identity-service";

import { adventConfig, at, newAdventService, playDay } from "../support/advent";

const CONSENT = { consent: true, marketingConsent: false, reminderOptIn: false };

function setup(patch?: (draft: Record<string, any>) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const base = newAdventService(adventConfig(patch));
  const sent: Array<{ email: string; link: string; token: string }> = [];
  const failures: string[] = [];
  let failNext = false;
  const identity = new IdentityService({
    repository: base.repository,
    advent: base.advent,
    verifyEndpoint: "https://advent.test/api/advent/identity/verify",
    sendLoginLink: async (email, link) => {
      if (failNext) {
        failNext = false;
        throw new Error("SMTP unavailable");
      }
      sent.push({ email, link, token: new URL(link).searchParams.get("token")! });
    },
    recordDeliveryFailure: async (participantId) => {
      failures.push(participantId);
    }
  });
  return { ...base, identity, sent, failures, failNext: () => { failNext = true; } };
}

afterEach(() => vi.restoreAllMocks());

describe("IdentityService.requestLink", () => {
  it("нормализует email, отправляет ссылку с одноразовым токеном, хранится только хеш", async () => {
    const { service, identity, sent } = setup();
    const { participant } = await service.createParticipant(at(1));
    await identity.requestLink(participant.id, { ...CONSENT, email: "  Kate@Example.TEST " }, at(1));

    expect(sent).toHaveLength(1);
    expect(sent[0].email).toBe("kate@example.test");
    expect(sent[0].link).toMatch(/^https:\/\/advent\.test\/api\/advent\/identity\/verify\?token=/);
    expect(sent[0].token.length).toBeGreaterThanOrEqual(32);
    // Хеш токена — не токен: подставив хеш вместо токена, войти нельзя.
    await expect(identity.verify(hashToken(sent[0].token), null, at(1))).rejects.toMatchObject({ code: "invalid" });
    await expect(identity.verify(sent[0].token, null, at(1))).resolves.toBeDefined();
  });

  it("без согласия на обработку данных ссылка не отправляется", async () => {
    const { service, identity, sent } = setup();
    const { participant } = await service.createParticipant(at(1));
    await expect(identity.requestLink(participant.id, { email: "a@b.co", consent: false, marketingConsent: true, reminderOptIn: true }, at(1))).rejects.toMatchObject({ code: "conflict" });
    expect(sent).toEqual([]);
  });

  it("неверный email, неизвестный участник и закрытая кампания отвергаются", async () => {
    const { service, identity, sent } = setup();
    const { participant } = await service.createParticipant(at(1));
    for (const email of ["", "не-почта", "a@b", "a b@c.de", `${"x".repeat(250)}@b.co`]) {
      await expect(identity.requestLink(participant.id, { ...CONSENT, email }, at(1))).rejects.toMatchObject({ code: "invalid" });
    }
    await expect(identity.requestLink("00000000-0000-4000-8000-000000000000", { ...CONSENT, email: "a@b.co" }, at(1))).rejects.toMatchObject({ code: "not_found" });
    await expect(identity.requestLink("плохой-id", { ...CONSENT, email: "a@b.co" }, at(1))).rejects.toMatchObject({ code: "not_found" });
    await expect(identity.requestLink(participant.id, { ...CONSENT, email: "a@b.co" }, new Date("2027-02-01T00:00:00+03:00"))).rejects.toMatchObject({ code: "conflict" });
    expect(sent).toEqual([]);
  });

  it("ошибка доставки записывается без адреса и пробрасывается", async () => {
    const { service, identity, failures, failNext } = setup();
    const { participant } = await service.createParticipant(at(1));
    failNext();
    await expect(identity.requestLink(participant.id, { ...CONSENT, email: "a@b.co" }, at(1))).rejects.toThrow("SMTP unavailable");
    expect(failures).toEqual([participant.id]);
  });

  it("не пишет email, токены и ссылки в логи на всём пути запрос → подтверждение", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const { service, identity, sent } = setup();
    const { participant, accessKey } = await service.createParticipant(at(1));
    await identity.requestLink(participant.id, { ...CONSENT, email: "secret.person@example.test" }, at(1));
    const result = await identity.verify(sent[0].token, participant, at(1));
    const output = spies.flatMap((spy) => spy.mock.calls).flat().map(String).join("\n");
    for (const secret of ["secret.person@example.test", sent[0].token, accessKey, result.accessKey]) expect(output).not.toContain(secret);
  });
});

describe("IdentityService.verify", () => {
  it("привязывает email, хранит согласия раздельно и выдаёт новый ключ устройства", async () => {
    const { service, identity, sent } = setup();
    const { participant } = await service.createParticipant(at(1));
    await identity.requestLink(participant.id, { email: "anna@example.test", consent: true, marketingConsent: false, reminderOptIn: true }, at(1, 10));
    const { participant: verified, accessKey } = await identity.verify(sent[0].token, participant, at(1, 10, 5));

    expect(verified).toMatchObject({ id: participant.id, normalizedEmail: "anna@example.test", reminderOptIn: true });
    expect(verified.consentAt).toEqual(at(1, 10));
    // Согласие на рассылку — отдельный чекбокс: его не дали, и оно не появилось из согласия на обработку.
    expect(verified.marketingConsentAt).toBeNull();
    expect((await service.identify(accessKey))?.id).toBe(participant.id);
    const state = await service.state(participant.id, at(1, 11));
    expect(state.participant).toEqual({ id: participant.id, email: "a***@example.test", consent: true, marketingConsent: false, reminderOptIn: true });
  });

  it("согласие на рассылку записывается отдельно, с временем", async () => {
    const { service, identity, sent } = setup();
    const { participant } = await service.createParticipant(at(1));
    await identity.requestLink(participant.id, { email: "m@example.test", consent: true, marketingConsent: true, reminderOptIn: false }, at(1, 9));
    const { participant: verified } = await identity.verify(sent[0].token, null, at(1, 9, 1));
    expect(verified.marketingConsentAt).toEqual(at(1, 9));
    expect(verified.reminderOptIn).toBe(false);
  });

  it("напоминания не включаются, если кампания их не использует (channel: off)", async () => {
    const { service, identity, sent } = setup((draft) => { draft.reminders.channel = "off"; });
    const { participant } = await service.createParticipant(at(1));
    await identity.requestLink(participant.id, { email: "a@b.co", consent: true, marketingConsent: false, reminderOptIn: true }, at(1));
    expect((await identity.verify(sent[0].token, null, at(1))).participant.reminderOptIn).toBe(false);
  });

  it("ссылка одноразовая и живёт 30 минут", async () => {
    const { service, identity, sent } = setup();
    const { participant } = await service.createParticipant(at(1));
    await identity.requestLink(participant.id, { ...CONSENT, email: "a@b.co" }, at(1, 10));
    await identity.requestLink(participant.id, { ...CONSENT, email: "a@b.co" }, at(1, 10, 1));
    const [first, second] = sent;

    await expect(identity.verify(first.token, null, new Date(at(1, 10).getTime() + LOGIN_TOKEN_TTL_MS + 1))).rejects.toMatchObject({ code: "expired" });
    await identity.verify(second.token, null, new Date(at(1, 10, 1).getTime() + LOGIN_TOKEN_TTL_MS));
    await expect(identity.verify(second.token, null, at(1, 10, 5))).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("уже использована") });
    await expect(identity.verify("совсем-чужой-токен", null, at(1, 10, 5))).rejects.toMatchObject({ code: "invalid" });
  });

  it("токен чужой кампании недействителен", async () => {
    const first = setup();
    const other = new IdentityService({
      repository: first.repository,
      advent: adventConfig((draft) => { draft.slug = "other-advent"; }),
      verifyEndpoint: "https://x.test/v",
      sendLoginLink: async () => undefined
    });
    const { participant } = await first.service.createParticipant(at(1));
    await first.identity.requestLink(participant.id, { ...CONSENT, email: "a@b.co" }, at(1));
    await expect(other.verify(first.sent[0].token, null, at(1))).rejects.toMatchObject({ code: "invalid" });
  });

  it("второе устройство: прогресс объединяется, награды не дублируются, обе cookie ведут к одному участнику", async () => {
    const { service, identity, sent, repository, advent } = setup();
    // Устройство A: дни 1–2 пройдены, email подтверждён.
    const a = await service.createParticipant(at(1));
    for (const n of [1, 2]) {
      await service.openDay(a.participant.id, n, at(n, 9));
      await playDay(service, advent, a.participant.id, n, at(n, 10));
    }
    await identity.requestLink(a.participant.id, { ...CONSENT, email: "kate@example.test" }, at(2, 11));
    await identity.verify(sent[0].token, a.participant, at(2, 11));

    // Устройство B: свой анонимный участник уже открыл день 2 (поздно вечером) и день 3.
    const b = await service.createParticipant(at(2, 20));
    await service.openDay(b.participant.id, 2, at(2, 21));
    await service.openDay(b.participant.id, 3, at(3, 9));
    await playDay(service, advent, b.participant.id, 3, at(3, 10));
    await identity.requestLink(b.participant.id, { ...CONSENT, email: "KATE@example.test", marketingConsent: true }, at(3, 12));
    const verified = await identity.verify(sent[1].token, b.participant, at(3, 12));

    expect(verified.participant.id).toBe(a.participant.id);
    expect(await repository.getParticipant(b.participant.id)).toBeNull();
    expect((await service.identify(b.accessKey))?.id).toBe(a.participant.id);
    expect((await service.identify(a.accessKey))?.id).toBe(a.participant.id);
    expect((await service.identify(verified.accessKey))?.id).toBe(a.participant.id);

    const state = await service.state(a.participant.id, at(3, 13));
    expect(state.doors.slice(0, 3).map((door) => door.status)).toEqual(["opened", "opened", "opened"]);
    // День 2 открыт на A вовремя: onTime по ИЛИ, openedAt самый ранний.
    const opens = await repository.listDayOpens(a.participant.id);
    expect(opens.find((open) => open.day === 2)).toMatchObject({ onTime: true, openedAt: at(2, 9) });
    // Награды объединены без дублей: по одной награде дня на каждый пройденный день, подаренный день один.
    const grants = await repository.listGrants(a.participant.id);
    const keys = grants.map((grant) => `${grant.source}:${grant.day}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => key.startsWith("day:")).sort()).toEqual(["day:1", "day:2", "day:3"]);
    expect(keys.filter((key) => key.startsWith("endowed"))).toHaveLength(1);
    // Согласие на рассылку добавилось от второго запроса.
    expect(state.participant).toMatchObject({ marketingConsent: true });
  });

  it("email остаётся уникальным при параллельных подтверждениях с двух устройств", async () => {
    const { service, identity, sent, repository } = setup();
    const a = await service.createParticipant(at(1));
    const b = await service.createParticipant(at(1));
    await service.openDay(a.participant.id, 1, at(1));
    await service.openDay(b.participant.id, 1, at(1, 13));
    await identity.requestLink(a.participant.id, { ...CONSENT, email: "race@example.test" }, at(1, 14));
    await identity.requestLink(b.participant.id, { ...CONSENT, email: "race@example.test" }, at(1, 14));

    const [first, second] = await Promise.all([
      identity.verify(sent[0].token, a.participant, at(1, 14, 10)),
      identity.verify(sent[1].token, b.participant, at(1, 14, 10))
    ]);
    expect(first.participant.id).toBe(second.participant.id);
    const survivors = [a.participant.id, b.participant.id].filter((id) => id === first.participant.id);
    expect(survivors).toHaveLength(1);
    expect(await Promise.all([a, b].map((device) => service.identify(device.accessKey)))).toEqual([
      expect.objectContaining({ id: first.participant.id }),
      expect.objectContaining({ id: first.participant.id })
    ]);
    expect(await repository.listDayOpens(first.participant.id)).toHaveLength(1);
  });

  it("AdventService.identify не пускает по ключу участника другой кампании", async () => {
    const { service, repository } = setup();
    const { accessKey } = await service.createParticipant(at(1));
    const foreign = new AdventService(repository, adventConfig((draft) => { draft.slug = "foreign-advent"; }));
    expect(await foreign.identify(accessKey)).toBeNull();
  });
});
