import { beforeEach, describe, expect, it } from "vitest";

import { DomainError } from "@/domain/errors";
import { createId, hashToken } from "@/server/crypto";
import type {
  AdventRepository,
  CodeSource,
  IdentityRepository,
  IssueGrantResult,
  LoginTokenRecord,
  ParticipantRecord,
  RewardGrantRecord
} from "@/server/repositories/advent-repository";

export type AdventBackend = AdventRepository & IdentityRepository;

export const CAMPAIGN = "contract-advent";
export const OTHER_CAMPAIGN = "contract-advent-other";

const T0 = new Date("2026-12-20T09:00:00Z");
const minutes = (value: number) => new Date(T0.getTime() + value * 60_000);

export function participantRecord(overrides: Partial<ParticipantRecord> = {}): ParticipantRecord {
  const id = overrides.id ?? createId();
  return {
    id,
    campaignSlug: CAMPAIGN,
    accessKeyHash: hashToken(`key-${id}`),
    normalizedEmail: null,
    teamId: null,
    consentAt: null,
    marketingConsentAt: null,
    reminderOptIn: false,
    unsubscribeHash: null,
    createdAt: T0,
    ...overrides
  };
}

export function grantRecord(participantId: string, overrides: Partial<RewardGrantRecord> = {}): RewardGrantRecord {
  return {
    id: createId(),
    participantId,
    day: 1,
    source: "day",
    rewardId: "daily-gift",
    code: null,
    expiresAt: null,
    status: "issued",
    redeemedAt: null,
    createdAt: T0,
    ...overrides
  };
}

export function tokenRecord(participantId: string, email: string, overrides: Partial<LoginTokenRecord> = {}): LoginTokenRecord {
  return {
    tokenHash: hashToken(`token-${createId()}`),
    participantId,
    normalizedEmail: email,
    consentAt: T0,
    marketingConsentAt: null,
    reminderOptIn: false,
    createdAt: T0,
    expiresAt: minutes(30),
    usedAt: null,
    ...overrides
  };
}

/**
 * Общие проверки контракта репозиториев адвента. Запускаются на in-memory (юнит-тесты) и на Prisma/PostgreSQL
 * (интеграционные): оба обязаны вести себя одинаково.
 */
export function describeAdventRepositoryContract(name: string, create: () => Promise<AdventBackend>): void {
  describe(`контракт репозиториев адвента: ${name}`, () => {
    let repo: AdventBackend;
    beforeEach(async () => {
      repo = await create();
    });

    const newParticipant = (overrides: Partial<ParticipantRecord> = {}) => repo.createParticipant(participantRecord(overrides));

    describe("участники", () => {
      it("создаёт участника и находит по хешу ключа и по id", async () => {
        const created = await newParticipant();
        expect(await repo.getParticipant(created.id)).toEqual(created);
        expect((await repo.findParticipantByAccessKeyHash(created.accessKeyHash))?.id).toBe(created.id);
        expect(await repo.findParticipantByAccessKeyHash(hashToken("нет такого"))).toBeNull();
        expect(await repo.getParticipant(createId())).toBeNull();
      });
    });

    describe("openDayOnce", () => {
      it("идемпотентно: повтор возвращает первую запись, время и onTime не меняются", async () => {
        const { id } = await newParticipant();
        const first = await repo.openDayOnce(id, 3, minutes(1), true);
        const second = await repo.openDayOnce(id, 3, minutes(50), false);
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.open).toEqual(first.open);
        expect(await repo.listDayOpens(id)).toHaveLength(1);
      });

      it("параллельные открытия одного дня создают одну запись", async () => {
        const { id } = await newParticipant();
        const results = await Promise.all(Array.from({ length: 6 }, (_, index) => repo.openDayOnce(id, 2, minutes(index), index % 2 === 0)));
        expect(results.filter((result) => result.created)).toHaveLength(1);
        expect(new Set(results.map((result) => result.open.openedAt.getTime())).size).toBe(1);
      });

      it("для неизвестного участника — not_found", async () => {
        await expect(repo.openDayOnce(createId(), 1, T0, true)).rejects.toMatchObject({ code: "not_found" });
      });

      it("список дней отсортирован по номеру", async () => {
        const { id } = await newParticipant();
        for (const day of [5, 1, 3]) await repo.openDayOnce(id, day, T0, true);
        expect((await repo.listDayOpens(id)).map((open) => open.day)).toEqual([1, 3, 5]);
      });
    });

    describe("recordBlockResultOnce", () => {
      const draft = (participantId: string, result: unknown, points = 100) => ({ participantId, day: 1, blockIndex: 1, result, points, createdAt: T0 });

      it("идемпотентно: повтор с другим результатом возвращает сохранённый", async () => {
        const { id } = await newParticipant();
        const first = await repo.recordBlockResultOnce(draft(id, { base: 100 }));
        const second = await repo.recordBlockResultOnce(draft(id, { base: 0 }, 0));
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.result.result).toEqual({ base: 100 });
        expect(second.result.points).toBe(100);
        expect(await repo.listBlockResults(id)).toHaveLength(1);
      });

      it("параллельные записи одного блока создают одну запись", async () => {
        const { id } = await newParticipant();
        const results = await Promise.all(Array.from({ length: 5 }, (_, index) => repo.recordBlockResultOnce(draft(id, { index }, index))));
        expect(results.filter((result) => result.created)).toHaveLength(1);
        expect(new Set(results.map((result) => JSON.stringify(result.result.result))).size).toBe(1);
      });

      it("для неизвестного участника — not_found", async () => {
        await expect(repo.recordBlockResultOnce(draft(createId(), {}))).rejects.toMatchObject({ code: "not_found" });
      });
    });

    describe("grantOnce", () => {
      it("уникален по (участник, источник, день): вторая выдача возвращает первую", async () => {
        const { id } = await newParticipant();
        const first = await repo.grantOnce(grantRecord(id));
        const second = await repo.grantOnce(grantRecord(id, { rewardId: "другая" }));
        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.grant.id).toBe(first.grant.id);
        expect(second.grant.rewardId).toBe("daily-gift");
      });

      it("разные источники и дни — разные выдачи; день 0 — ключ «раз за кампанию»", async () => {
        const { id } = await newParticipant();
        await repo.grantOnce(grantRecord(id, { source: "day", day: 1 }));
        await repo.grantOnce(grantRecord(id, { source: "day", day: 2 }));
        await repo.grantOnce(grantRecord(id, { source: "goal", day: 1 }));
        const comeback1 = await repo.grantOnce(grantRecord(id, { source: "comeback", day: 0, rewardId: "back" }));
        const comeback2 = await repo.grantOnce(grantRecord(id, { source: "comeback", day: 0, rewardId: "back" }));
        expect(comeback1.created).toBe(true);
        expect(comeback2.created).toBe(false);
        expect(await repo.listGrants(id)).toHaveLength(4);
      });

      it("параллельные выдачи создают одну запись", async () => {
        const { id } = await newParticipant();
        const results = await Promise.all(Array.from({ length: 6 }, () => repo.grantOnce(grantRecord(id, { source: "goal", day: 5 }))));
        expect(results.filter((result) => result.created)).toHaveLength(1);
        expect(new Set(results.map((result) => result.grant.id)).size).toBe(1);
      });

      it("для неизвестного участника — not_found", async () => {
        await expect(repo.grantOnce(grantRecord(createId()))).rejects.toMatchObject({ code: "not_found" });
      });
    });

    describe("mergeParticipants", () => {
      it("объединяет дни (раннее openedAt, onTime по ИЛИ), дедуплицирует результаты и награды, переносит ключи", async () => {
        const into = await newParticipant();
        const from = await newParticipant();
        await repo.openDayOnce(into.id, 1, minutes(10), false);
        await repo.openDayOnce(from.id, 1, minutes(5), true);
        await repo.openDayOnce(into.id, 2, minutes(20), true);
        await repo.openDayOnce(from.id, 3, minutes(30), false);
        await repo.recordBlockResultOnce({ participantId: into.id, day: 1, blockIndex: 0, result: { by: "into" }, points: 100, createdAt: T0 });
        await repo.recordBlockResultOnce({ participantId: from.id, day: 1, blockIndex: 0, result: { by: "from" }, points: 0, createdAt: T0 });
        await repo.recordBlockResultOnce({ participantId: from.id, day: 3, blockIndex: 0, result: { by: "from" }, points: 50, createdAt: T0 });
        await repo.grantOnce(grantRecord(into.id, { day: 1, rewardId: "into-gift" }));
        await repo.grantOnce(grantRecord(from.id, { day: 1, rewardId: "from-gift" }));
        await repo.grantOnce(grantRecord(from.id, { source: "comeback", day: 0, rewardId: "back" }));

        await repo.mergeParticipants(from.id, into.id);

        expect(await repo.getParticipant(from.id)).toBeNull();
        const opens = await repo.listDayOpens(into.id);
        expect(opens.map((open) => [open.day, open.openedAt.getTime(), open.onTime])).toEqual([
          [1, minutes(5).getTime(), true],
          [2, minutes(20).getTime(), true],
          [3, minutes(30).getTime(), false]
        ]);
        const results = await repo.listBlockResults(into.id);
        expect(results.map((result) => [result.day, result.blockIndex, (result.result as { by: string }).by])).toEqual([
          [1, 0, "into"],
          [3, 0, "from"]
        ]);
        const grants = await repo.listGrants(into.id);
        expect(grants.map((grant) => [grant.source, grant.day, grant.rewardId]).sort()).toEqual([
          ["comeback", 0, "back"],
          ["day", 1, "into-gift"]
        ]);
        // Cookie поглощённого устройства теперь ведёт к итоговому участнику.
        expect((await repo.findParticipantByAccessKeyHash(from.accessKeyHash))?.id).toBe(into.id);
        expect((await repo.findParticipantByAccessKeyHash(into.accessKeyHash))?.id).toBe(into.id);
      });

      it("слияние в себя — пустая операция", async () => {
        const one = await newParticipant();
        await repo.openDayOnce(one.id, 1, T0, true);
        await repo.mergeParticipants(one.id, one.id);
        expect(await repo.listDayOpens(one.id)).toHaveLength(1);
      });

      it("отказывает, если у поглощаемого есть email, участники из разных кампаний или одного нет", async () => {
        const into = await newParticipant();
        const withEmail = await newParticipant({ normalizedEmail: "a@b.co" });
        const foreign = await newParticipant({ campaignSlug: OTHER_CAMPAIGN });
        await expect(repo.mergeParticipants(withEmail.id, into.id)).rejects.toMatchObject({ code: "invalid" });
        await expect(repo.mergeParticipants(foreign.id, into.id)).rejects.toMatchObject({ code: "invalid" });
        await expect(repo.mergeParticipants(createId(), into.id)).rejects.toMatchObject({ code: "not_found" });
        expect(await repo.getParticipant(withEmail.id)).not.toBeNull();
      });

      it("неиспользованные ссылки входа поглощённого участника удаляются и не меняют email итогового", async () => {
        const into = await newParticipant({ normalizedEmail: "owner@example.test" });
        const from = await newParticipant();
        const token = tokenRecord(from.id, "x@y.co");
        await repo.createLoginToken(token);
        await repo.mergeParticipants(from.id, into.id);
        await expect(
          repo.completeLogin({ tokenHash: token.tokenHash, now: minutes(1), campaignSlug: CAMPAIGN, currentParticipantId: null, newAccessKeyHash: hashToken("dev") })
        ).rejects.toMatchObject({ code: "invalid" });
        expect((await repo.getParticipant(into.id))?.normalizedEmail).toBe("owner@example.test");
      });
    });

    describe("completeLogin", () => {
      const login = (tokenHash: string, extra: { current?: string | null; key?: string; now?: Date; campaign?: string } = {}) =>
        repo.completeLogin({
          tokenHash,
          now: extra.now ?? minutes(1),
          campaignSlug: extra.campaign ?? CAMPAIGN,
          currentParticipantId: extra.current ?? null,
          newAccessKeyHash: extra.key ?? hashToken(`device-${createId()}`)
        });

      it("привязывает email и согласия запросившему, выдаёт новый ключ устройству, ссылка одноразовая", async () => {
        const participant = await newParticipant();
        const token = tokenRecord(participant.id, "anna@example.test", { marketingConsentAt: minutes(0), reminderOptIn: true });
        await repo.createLoginToken(token);
        const key = hashToken("new-device");

        const result = await login(token.tokenHash, { key, current: participant.id });

        expect(result.mergedFrom).toEqual([]);
        expect(result.participant).toMatchObject({
          id: participant.id,
          normalizedEmail: "anna@example.test",
          reminderOptIn: true
        });
        expect(result.participant.consentAt).toEqual(T0);
        expect(result.participant.marketingConsentAt).toEqual(minutes(0));
        expect((await repo.findParticipantByAccessKeyHash(key))?.id).toBe(participant.id);
        // Ссылку открыли на запросившем устройстве: его прежний ключ тоже действует.
        expect((await repo.findParticipantByAccessKeyHash(participant.accessKeyHash))?.id).toBe(participant.id);
        await expect(login(token.tokenHash, { current: participant.id })).rejects.toMatchObject({ code: "conflict" });
      });

      it("ссылку открыли на другом устройстве: ключи запросившего отзываются, доступ только у открывшего", async () => {
        const requester = await newParticipant();
        await repo.openDayOnce(requester.id, 1, minutes(0), true);
        const token = tokenRecord(requester.id, "fresh@example.test");
        await repo.createLoginToken(token);
        const key = hashToken("clicked-device");

        const result = await login(token.tokenHash, { key });

        expect(result.participant).toMatchObject({ id: requester.id, normalizedEmail: "fresh@example.test" });
        expect((await repo.listDayOpens(requester.id)).map((open) => open.day)).toEqual([1]);
        expect((await repo.findParticipantByAccessKeyHash(key))?.id).toBe(requester.id);
        expect(await repo.findParticipantByAccessKeyHash(requester.accessKeyHash)).toBeNull();
      });

      it("злоумышленник запросил ссылку на чужой адрес, владелец её открыл: доступа к владельцу у злоумышленника нет", async () => {
        const victim = await newParticipant();
        await repo.openDayOnce(victim.id, 1, minutes(0), true);
        const own = tokenRecord(victim.id, "victim@example.test");
        await repo.createLoginToken(own);
        const victimKey = hashToken("victim-device");
        await login(own.tokenHash, { current: victim.id, key: victimKey });

        const attacker = await newParticipant();
        await repo.openDayOnce(attacker.id, 2, minutes(5), true);
        // Ссылка на свой адрес, которую злоумышленник откроет позже, и ссылка на адрес жертвы.
        const later = tokenRecord(attacker.id, "attacker@example.test");
        const lure = tokenRecord(attacker.id, "victim@example.test");
        await repo.createLoginToken(later);
        await repo.createLoginToken(lure);

        // Жертва (или сканер писем без cookie) открывает ссылку на своём устройстве.
        const result = await login(lure.tokenHash, { current: victim.id });
        expect(result.participant.id).toBe(victim.id);
        expect(await repo.findParticipantByAccessKeyHash(attacker.accessKeyHash)).toBeNull();
        expect((await repo.findParticipantByAccessKeyHash(victimKey))?.id).toBe(victim.id);

        // Отложенная ссылка злоумышленника не перешла к жертве и не меняет её email.
        await expect(login(later.tokenHash)).rejects.toMatchObject({ code: "invalid" });
        expect((await repo.getParticipant(victim.id))?.normalizedEmail).toBe("victim@example.test");
      });

      it("злоумышленник запросил ссылку на свободный чужой адрес: после открытия владельцем его cookie не действует", async () => {
        const attacker = await newParticipant();
        const lure = tokenRecord(attacker.id, "free@example.test");
        await repo.createLoginToken(lure);
        const victimDevice = await newParticipant();
        const key = hashToken("victim-device");

        const result = await login(lure.tokenHash, { current: victimDevice.id, key });

        expect(result.participant.normalizedEmail).toBe("free@example.test");
        expect(await repo.findParticipantByAccessKeyHash(attacker.accessKeyHash)).toBeNull();
        expect((await repo.findParticipantByAccessKeyHash(key))?.id).toBe(result.participant.id);
        expect((await repo.findParticipantByAccessKeyHash(victimDevice.accessKeyHash))?.id).toBe(result.participant.id);
      });

      it("неизвестная, чужой кампании и просроченная ссылки отвергаются", async () => {
        const participant = await newParticipant();
        const token = tokenRecord(participant.id, "a@b.co");
        await repo.createLoginToken(token);
        await expect(login(hashToken("unknown"))).rejects.toMatchObject({ code: "invalid" });
        await expect(login(token.tokenHash, { campaign: OTHER_CAMPAIGN })).rejects.toMatchObject({ code: "invalid" });
        await expect(login(token.tokenHash, { now: minutes(31) })).rejects.toMatchObject({ code: "expired" });
        // Просроченная ссылка не считается использованной и не привязывает email.
        expect((await repo.getParticipant(participant.id))?.normalizedEmail).toBeNull();
        const ok = await login(token.tokenHash, { now: minutes(29) });
        expect(ok.participant.normalizedEmail).toBe("a@b.co");
      });

      it("второе устройство: email уже у другого участника — итоговым становится он, анонимный прогресс вливается", async () => {
        const owner = await newParticipant();
        await repo.openDayOnce(owner.id, 1, minutes(0), true);
        const firstToken = tokenRecord(owner.id, "kate@example.test", { marketingConsentAt: minutes(0) });
        await repo.createLoginToken(firstToken);
        await login(firstToken.tokenHash);

        // Второе устройство: свой анонимный участник с другим прогрессом.
        const second = await newParticipant();
        await repo.openDayOnce(second.id, 1, minutes(100), false);
        await repo.openDayOnce(second.id, 2, minutes(110), true);
        await repo.grantOnce(grantRecord(second.id, { day: 2 }));
        const secondToken = tokenRecord(second.id, "kate@example.test", { reminderOptIn: true, consentAt: minutes(100) });
        await repo.createLoginToken(secondToken);

        const key = hashToken("second-device");
        const result = await login(secondToken.tokenHash, { current: second.id, key });

        expect(result.participant.id).toBe(owner.id);
        expect(result.mergedFrom).toEqual([second.id]);
        expect(await repo.getParticipant(second.id)).toBeNull();
        expect((await repo.listDayOpens(owner.id)).map((open) => [open.day, open.onTime])).toEqual([
          [1, true],
          [2, true]
        ]);
        expect(await repo.listGrants(owner.id)).toHaveLength(1);
        expect((await repo.findParticipantByAccessKeyHash(key))?.id).toBe(owner.id);
        expect((await repo.findParticipantByAccessKeyHash(second.accessKeyHash))?.id).toBe(owner.id);
        // Согласия монотонны: первое сохраняется, напоминания включены по ИЛИ.
        expect(result.participant.consentAt).toEqual(T0);
        expect(result.participant.marketingConsentAt).toEqual(minutes(0));
        expect(result.participant.reminderOptIn).toBe(true);
      });

      it("текущий анонимный участник устройства вливается в запросившего, если email свободен", async () => {
        const requester = await newParticipant();
        const device = await newParticipant();
        await repo.openDayOnce(device.id, 4, minutes(5), true);
        const token = tokenRecord(requester.id, "new@example.test");
        await repo.createLoginToken(token);
        const result = await login(token.tokenHash, { current: device.id });
        expect(result.participant.id).toBe(requester.id);
        expect(result.mergedFrom).toEqual([device.id]);
        expect((await repo.listDayOpens(requester.id)).map((open) => open.day)).toEqual([4]);
      });

      it("текущий участник устройства с другим email не вливается", async () => {
        const other = await newParticipant({ normalizedEmail: "other@example.test" });
        const requester = await newParticipant();
        const token = tokenRecord(requester.id, "mine@example.test");
        await repo.createLoginToken(token);
        const result = await login(token.tokenHash, { current: other.id });
        expect(result.mergedFrom).toEqual([]);
        expect(await repo.getParticipant(other.id)).not.toBeNull();
      });

      it("email уникален в кампании, но свободен в другой", async () => {
        const mine = await newParticipant();
        const foreign = await newParticipant({ campaignSlug: OTHER_CAMPAIGN });
        const a = tokenRecord(mine.id, "same@example.test");
        const b = tokenRecord(foreign.id, "same@example.test");
        await repo.createLoginToken(a);
        await repo.createLoginToken(b);
        const first = await login(a.tokenHash);
        const second = await login(b.tokenHash, { campaign: OTHER_CAMPAIGN });
        expect(first.participant.id).toBe(mine.id);
        expect(second.participant.id).toBe(foreign.id);
      });

      it("два устройства подтверждают один email одновременно: остаётся один участник, прогресс объединён", async () => {
        const a = await newParticipant();
        const b = await newParticipant();
        await repo.openDayOnce(a.id, 1, minutes(1), true);
        await repo.openDayOnce(b.id, 2, minutes(2), true);
        const tokenA = tokenRecord(a.id, "race@example.test");
        const tokenB = tokenRecord(b.id, "race@example.test");
        await repo.createLoginToken(tokenA);
        await repo.createLoginToken(tokenB);

        const [first, second] = await Promise.all([login(tokenA.tokenHash, { current: a.id }), login(tokenB.tokenHash, { current: b.id })]);

        expect(first.participant.id).toBe(second.participant.id);
        const survivor = first.participant.id;
        expect([a.id, b.id]).toContain(survivor);
        expect((await repo.listDayOpens(survivor)).map((open) => open.day)).toEqual([1, 2]);
        const gone = survivor === a.id ? b.id : a.id;
        expect(await repo.getParticipant(gone)).toBeNull();
        expect((await repo.getParticipant(survivor))?.normalizedEmail).toBe("race@example.test");
        // Оба устройства (старые ключи) ведут к одному участнику.
        expect((await repo.findParticipantByAccessKeyHash(a.accessKeyHash))?.id).toBe(survivor);
        expect((await repo.findParticipantByAccessKeyHash(b.accessKeyHash))?.id).toBe(survivor);
      });

      it("повторное подтверждение одной ссылки параллельно: успешно ровно одно", async () => {
        const participant = await newParticipant();
        const token = tokenRecord(participant.id, "once@example.test");
        await repo.createLoginToken(token);
        const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => login(token.tokenHash)));
        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        for (const outcome of outcomes) {
          if (outcome.status === "rejected") expect(outcome.reason).toBeInstanceOf(DomainError);
        }
      });

      it("createLoginToken для неизвестного участника — not_found", async () => {
        await expect(repo.createLoginToken(tokenRecord(createId(), "a@b.co"))).rejects.toMatchObject({ code: "not_found" });
      });
    });

    describe("очистка ПДн", () => {
      it("deleteStaleLoginTokens удаляет использованные и просроченные ссылки, живые остаются", async () => {
        const participant = await newParticipant();
        const live = tokenRecord(participant.id, "live@example.test", { expiresAt: minutes(30) });
        const expired = tokenRecord(participant.id, "expired@example.test", { expiresAt: minutes(5) });
        const used = tokenRecord(participant.id, "used@example.test", { expiresAt: minutes(30) });
        for (const token of [live, expired, used]) await repo.createLoginToken(token);
        await repo.completeLogin({ tokenHash: used.tokenHash, now: minutes(1), campaignSlug: CAMPAIGN, currentParticipantId: participant.id, newAccessKeyHash: hashToken("k") });

        expect(await repo.deleteStaleLoginTokens(minutes(10))).toBe(2);
        expect(await repo.deleteStaleLoginTokens(minutes(10))).toBe(0);
        await expect(
          repo.completeLogin({ tokenHash: expired.tokenHash, now: minutes(2), campaignSlug: CAMPAIGN, currentParticipantId: null, newAccessKeyHash: hashToken("k2") })
        ).rejects.toMatchObject({ code: "invalid" });
        // Живая ссылка по-прежнему работает (email меняется на её адрес).
        const ok = await repo.completeLogin({ tokenHash: live.tokenHash, now: minutes(11), campaignSlug: CAMPAIGN, currentParticipantId: participant.id, newAccessKeyHash: hashToken("k3") });
        expect(ok.participant.normalizedEmail).toBe("live@example.test");
      });

      it("anonymizeCampaignParticipants стирает email и согласия только в своей кампании, прогресс остаётся", async () => {
        const mine = await newParticipant({ normalizedEmail: "mine@example.test", consentAt: T0, marketingConsentAt: T0, reminderOptIn: true, unsubscribeHash: hashToken("u1") });
        const anonymous = await newParticipant();
        const foreign = await newParticipant({ campaignSlug: OTHER_CAMPAIGN, normalizedEmail: "foreign@example.test", consentAt: T0 });
        await repo.openDayOnce(mine.id, 1, T0, true);
        await repo.grantOnce(grantRecord(mine.id));
        const pending = tokenRecord(anonymous.id, "pending@example.test");
        await repo.createLoginToken(pending);

        expect(await repo.anonymizeCampaignParticipants(CAMPAIGN)).toBe(1);

        expect(await repo.getParticipant(mine.id)).toMatchObject({
          normalizedEmail: null,
          consentAt: null,
          marketingConsentAt: null,
          reminderOptIn: false,
          unsubscribeHash: null
        });
        expect(await repo.listDayOpens(mine.id)).toHaveLength(1);
        expect(await repo.listGrants(mine.id)).toHaveLength(1);
        expect((await repo.findParticipantByAccessKeyHash(mine.accessKeyHash))?.id).toBe(mine.id);
        expect((await repo.getParticipant(foreign.id))?.normalizedEmail).toBe("foreign@example.test");
        // Ссылки входа кампании (в них email) удалены.
        await expect(
          repo.completeLogin({ tokenHash: pending.tokenHash, now: minutes(1), campaignSlug: CAMPAIGN, currentParticipantId: null, newAccessKeyHash: hashToken("k") })
        ).rejects.toMatchObject({ code: "invalid" });
        expect(await repo.anonymizeCampaignParticipants(CAMPAIGN)).toBe(0);
      });
    });
    describe("награды: коды, остатки, погашение (A2)", () => {
      const REWARD = "pool-reward";
      const hours = (value: number) => new Date(T0.getTime() + value * 3_600_000);

      /** Выдача из пула: сам вызов `issueGrant` с источником `list`. */
      const issueFromPool = (participantId: string, overrides: Partial<RewardGrantRecord> = {}, extra: { consumeStock?: boolean; requireCode?: boolean; code?: CodeSource | null } = {}) =>
        repo.issueGrant({
          grant: grantRecord(participantId, { rewardId: REWARD, ...overrides }),
          campaignSlug: CAMPAIGN,
          consumeStock: extra.consumeStock ?? false,
          code: extra.code === undefined ? { kind: "list" } : extra.code,
          requireCode: extra.requireCode ?? false
        });

      const created = (result: IssueGrantResult) => {
        if (result.status !== "created" && result.status !== "existing") throw new Error(`ожидалась выдача, получено ${result.status}`);
        return result;
      };

      it("importCodes: дубли в кампании пропускаются (в том числе из другой награды), poolOverview считает свободные", async () => {
        expect(await repo.importCodes(CAMPAIGN, REWARD, ["A1", "A2", "A3"])).toEqual({ added: 3, duplicates: 0 });
        expect(await repo.importCodes(CAMPAIGN, REWARD, ["A3", "A4"])).toEqual({ added: 1, duplicates: 1 });
        expect(await repo.importCodes(CAMPAIGN, "other-reward", ["A1", "B1"])).toEqual({ added: 1, duplicates: 1 });
        // Та же строка в другой кампании — не дубль.
        expect(await repo.importCodes(OTHER_CAMPAIGN, REWARD, ["A1"])).toEqual({ added: 1, duplicates: 0 });
        expect(await repo.poolOverview(CAMPAIGN)).toEqual({ [REWARD]: { total: 4, free: 4 }, "other-reward": { total: 1, free: 1 } });
        const { id } = await newParticipant();
        created(await issueFromPool(id));
        expect((await repo.poolOverview(CAMPAIGN))[REWARD]).toEqual({ total: 4, free: 3 });
      });

      it("issueGrant из пула: код берётся один раз, повтор возвращает ту же выдачу, а другой участник получает другой код", async () => {
        await repo.importCodes(CAMPAIGN, REWARD, ["C1", "C2"]);
        const a = await newParticipant();
        const b = await newParticipant();
        const first = created(await issueFromPool(a.id));
        const again = created(await issueFromPool(a.id));
        const other = created(await issueFromPool(b.id));
        expect(first.status).toBe("created");
        expect(again.status).toBe("existing");
        expect(again.grant.id).toBe(first.grant.id);
        expect(again.grant.code).toBe(first.grant.code);
        expect(new Set([first.grant.code, other.grant.code])).toEqual(new Set(["C1", "C2"]));
        expect((await repo.listGrants(a.id))[0].code).toBe(first.grant.code);
        expect((await repo.findGrantsByCode(CAMPAIGN, first.grant.code!.toLowerCase())).map((grant) => grant.id)).toEqual([first.grant.id]);
        expect(await repo.findGrantsByCode(OTHER_CAMPAIGN, first.grant.code!)).toEqual([]);
      });

      it("параллельные выдачи не делят код; когда пул кончился, остальные получают отказ pool_empty без выдачи", async () => {
        await repo.importCodes(CAMPAIGN, REWARD, ["P01", "P02", "P03", "P04", "P05"]);
        const people = await Promise.all(Array.from({ length: 14 }, () => newParticipant()));
        const results = await Promise.all(people.map((person) => issueFromPool(person.id, {}, { requireCode: true })));
        const issued = results.filter((result) => result.status === "created");
        expect(issued).toHaveLength(5);
        expect(results.filter((result) => result.status === "pool_empty")).toHaveLength(9);
        const codes = issued.map((result) => (result as { grant: RewardGrantRecord }).grant.code);
        expect(new Set(codes).size).toBe(5);
        expect((await repo.poolOverview(CAMPAIGN))[REWARD]).toEqual({ total: 5, free: 0 });
        // Отказ ничего не записал: у отказанных нет выдач.
        const withGrants = await Promise.all(people.map(async (person) => (await repo.listGrants(person.id)).length));
        expect(withGrants.filter((count) => count === 1)).toHaveLength(5);
      });

      it("без requireCode пустой пул даёт выдачу без кода, а assignGrantCode дозаполняет её после пополнения (и ставит срок)", async () => {
        const { id } = await newParticipant();
        const result = created(await issueFromPool(id));
        expect(result).toMatchObject({ status: "created", codeMissing: true });
        expect(result.grant.code).toBeNull();
        const stillEmpty = await repo.assignGrantCode(result.grant.id, { kind: "list" }, hours(48));
        expect(stillEmpty.status).toBe("pool_empty");
        expect(stillEmpty.grant.expiresAt).toBeNull();

        await repo.importCodes(CAMPAIGN, REWARD, ["LATE1"]);
        const assigned = await repo.assignGrantCode(result.grant.id, { kind: "list" }, hours(48));
        expect(assigned).toMatchObject({ status: "assigned", grant: { code: "LATE1" } });
        expect(assigned.grant.expiresAt).toEqual(hours(48));
        // Идемпотентно: код и срок не меняются, второй код не берётся.
        await repo.importCodes(CAMPAIGN, REWARD, ["LATE2"]);
        const repeat = await repo.assignGrantCode(result.grant.id, { kind: "list" }, hours(99));
        expect(repeat).toMatchObject({ status: "existing", grant: { code: "LATE1" } });
        expect(repeat.grant.expiresAt).toEqual(hours(48));
        expect((await repo.poolOverview(CAMPAIGN))[REWARD]).toEqual({ total: 2, free: 1 });
        await expect(repo.assignGrantCode(createId(), { kind: "list" }, null)).rejects.toMatchObject({ code: "not_found" });
      });

      it("assignGrantCode без источника кода только проставляет срок, один раз", async () => {
        const { id } = await newParticipant();
        const { grant } = created(await issueFromPool(id, {}, { code: null }));
        expect((await repo.assignGrantCode(grant.id, null, hours(24))).grant.expiresAt).toEqual(hours(24));
        expect((await repo.assignGrantCode(grant.id, null, hours(72))).grant.expiresAt).toEqual(hours(24));
      });

      it("static: один код всем; generated: код попадает в пул кампании и столкновение даёт повтор с новым кодом", async () => {
        const a = await newParticipant();
        const b = await newParticipant();
        const staticA = created(await issueFromPool(a.id, { rewardId: "same" }, { code: { kind: "static", code: "HELLO" } }));
        const staticB = created(await issueFromPool(b.id, { rewardId: "same" }, { code: { kind: "static", code: "HELLO" } }));
        expect([staticA.grant.code, staticB.grant.code]).toEqual(["HELLO", "HELLO"]);
        expect(await repo.findGrantsByCode(CAMPAIGN, "hello")).toHaveLength(2);

        // Генератор сначала возвращает занятый код (HELLO в пуле нет, поэтому занимаем GEN1 импортом), затем свободный.
        await repo.importCodes(CAMPAIGN, "gen", ["GEN1"]);
        const queue = ["GEN1", "GEN1", "GEN2"];
        const c = await newParticipant();
        const generated = created(await issueFromPool(c.id, { rewardId: "gen" }, { code: { kind: "generated", next: () => queue.shift()! } }));
        expect(generated.grant.code).toBe("GEN2");
        expect(queue).toEqual([]);
        // Две выдачи подряд не получают одинаковых кодов, даже если генератор «залип».
        const d = await newParticipant();
        let attempts = 0;
        const next = () => (attempts++ < 3 ? "GEN2" : "GEN3");
        expect(created(await issueFromPool(d.id, { rewardId: "gen" }, { code: { kind: "generated", next } })).grant.code).toBe("GEN3");
      });

      it("остатки: ensureStock не сбрасывает идущий розыгрыш, выдача списывает по одному и не уходит в минус", async () => {
        await repo.ensureStock(CAMPAIGN, [{ rewardId: REWARD, left: 2 }]);
        const people = await Promise.all(Array.from({ length: 3 }, () => newParticipant()));
        created(await issueFromPool(people[0].id, {}, { consumeStock: true, code: null }));
        await repo.ensureStock(CAMPAIGN, [{ rewardId: REWARD, left: 50 }]); // повторное заведение не меняет остаток
        expect(await repo.stockLeft(CAMPAIGN)).toEqual({ [REWARD]: 1 });
        created(await issueFromPool(people[1].id, {}, { consumeStock: true, code: null }));
        expect(await issueFromPool(people[2].id, {}, { consumeStock: true, code: null })).toEqual({ status: "stock_exhausted" });
        expect(await repo.stockLeft(CAMPAIGN)).toEqual({ [REWARD]: 0 });
        expect(await repo.listGrants(people[2].id)).toEqual([]);
        // Строки остатка нет (розыгрыш не заводили) — это «нечего списывать», а не бесконечный запас.
        expect(await issueFromPool(people[2].id, { rewardId: "never-seeded" }, { consumeStock: true, code: null })).toEqual({ status: "stock_exhausted" });
      });

      it("остатки под нагрузкой: из 3 штук параллельно разбирают ровно 3, остаток не отрицателен", async () => {
        await repo.ensureStock(CAMPAIGN, [{ rewardId: REWARD, left: 3 }]);
        const people = await Promise.all(Array.from({ length: 12 }, () => newParticipant()));
        const results = await Promise.all(people.map((person) => issueFromPool(person.id, { source: "luck", day: 4 }, { consumeStock: true, code: null })));
        expect(results.filter((result) => result.status === "created")).toHaveLength(3);
        expect(results.filter((result) => result.status === "stock_exhausted")).toHaveLength(9);
        expect(await repo.stockLeft(CAMPAIGN)).toEqual({ [REWARD]: 0 });
      });

      it("повторные параллельные запросы одного участника списывают остаток один раз", async () => {
        await repo.ensureStock(CAMPAIGN, [{ rewardId: REWARD, left: 5 }]);
        const { id } = await newParticipant();
        const results = await Promise.all(Array.from({ length: 6 }, () => issueFromPool(id, { source: "luck", day: 4 }, { consumeStock: true, code: null })));
        expect(results.filter((result) => result.status === "created")).toHaveLength(1);
        expect(results.filter((result) => result.status === "existing")).toHaveLength(5);
        expect(await repo.stockLeft(CAMPAIGN)).toEqual({ [REWARD]: 4 });
        expect(await repo.listGrants(id)).toHaveLength(1);
      });

      it("пустой пул при requireCode откатывает и списание остатка", async () => {
        await repo.ensureStock(CAMPAIGN, [{ rewardId: REWARD, left: 2 }]);
        const { id } = await newParticipant();
        expect(await issueFromPool(id, {}, { consumeStock: true, requireCode: true })).toEqual({ status: "pool_empty" });
        expect(await repo.stockLeft(CAMPAIGN)).toEqual({ [REWARD]: 2 });
        expect(await repo.listGrants(id)).toEqual([]);
      });

      it("redeemGrant: погашение один раз, повтор, просрочка, чужая кампания, неизвестная выдача", async () => {
        const { id } = await newParticipant();
        const live = created(await issueFromPool(id, { day: 1, expiresAt: hours(24) }, { code: null })).grant;
        const old = created(await issueFromPool(id, { day: 2, expiresAt: hours(1) }, { code: null })).grant;
        const forever = created(await issueFromPool(id, { day: 3, expiresAt: null }, { code: null })).grant;

        expect(await repo.redeemGrant(CAMPAIGN, live.id, hours(2))).toMatchObject({ status: "redeemed", grant: { status: "redeemed", redeemedAt: hours(2) } });
        const again = await repo.redeemGrant(CAMPAIGN, live.id, hours(3));
        expect(again).toMatchObject({ status: "already_redeemed", grant: { redeemedAt: hours(2) } });
        expect(await repo.redeemGrant(CAMPAIGN, old.id, hours(2))).toMatchObject({ status: "expired", grant: { status: "issued", redeemedAt: null } });
        // Граница срока: в момент expiresAt награда уже просрочена.
        expect((await repo.redeemGrant(CAMPAIGN, old.id, hours(1))).status).toBe("expired");
        expect((await repo.redeemGrant(CAMPAIGN, forever.id, hours(1000))).status).toBe("redeemed");
        expect(await repo.redeemGrant(OTHER_CAMPAIGN, forever.id, hours(1))).toEqual({ status: "not_found" });
        expect(await repo.redeemGrant(CAMPAIGN, createId(), hours(1))).toEqual({ status: "not_found" });
        expect((await repo.getGrant(live.id))).toMatchObject({ id: live.id, campaignSlug: CAMPAIGN, status: "redeemed" });
        expect(await repo.getGrant(createId())).toBeNull();
      });

      it("параллельное погашение: ровно одно успешное", async () => {
        const { id } = await newParticipant();
        const { grant } = created(await issueFromPool(id, { expiresAt: hours(24) }, { code: null }));
        const results = await Promise.all(Array.from({ length: 6 }, (_, index) => repo.redeemGrant(CAMPAIGN, grant.id, hours(1 + index / 100))));
        expect(results.filter((result) => result.status === "redeemed")).toHaveLength(1);
        expect(results.filter((result) => result.status === "already_redeemed")).toHaveLength(5);
      });

      it("слияние: код отброшенной выдачи-дубля возвращается в пул, перенесённая выдача сохраняет свой код", async () => {
        await repo.importCodes(CAMPAIGN, REWARD, ["M1", "M2", "M3"]);
        const into = await newParticipant();
        const from = await newParticipant();
        const intoGrant = created(await issueFromPool(into.id, { day: 1 })).grant;
        const dup = created(await issueFromPool(from.id, { day: 1 })).grant; // тот же ключ (источник, день): будет отброшен
        const moved = created(await issueFromPool(from.id, { day: 2 })).grant;
        expect((await repo.poolOverview(CAMPAIGN))[REWARD]).toEqual({ total: 3, free: 0 });

        await repo.mergeParticipants(from.id, into.id);

        const grants = await repo.listGrants(into.id);
        expect(grants.map((grant) => [grant.day, grant.code])).toEqual([[1, intoGrant.code], [2, moved.code]]);
        expect((await repo.poolOverview(CAMPAIGN))[REWARD]).toEqual({ total: 3, free: 1 });
        // Освободившийся код снова выдаётся.
        const next = await newParticipant();
        expect(created(await issueFromPool(next.id, { day: 5 })).grant.code).toBe(dup.code);
      });

      it("выгрузка и итоги: все выдачи кампании, выдано и погашено по наградам", async () => {
        const a = await newParticipant();
        const b = await newParticipant();
        const foreign = await newParticipant({ campaignSlug: OTHER_CAMPAIGN });
        const g1 = created(await issueFromPool(a.id, { day: 1, rewardId: "r1" }, { code: null })).grant;
        created(await issueFromPool(a.id, { day: 2, rewardId: "r2" }, { code: null }));
        created(await issueFromPool(b.id, { day: 1, rewardId: "r1" }, { code: null }));
        await repo.issueGrant({ grant: grantRecord(foreign.id, { rewardId: "r1" }), campaignSlug: OTHER_CAMPAIGN, consumeStock: false, code: null, requireCode: false });
        await repo.redeemGrant(CAMPAIGN, g1.id, hours(1));
        expect((await repo.listCampaignGrants(CAMPAIGN)).map((grant) => grant.rewardId).sort()).toEqual(["r1", "r1", "r2"]);
        expect(await repo.grantTotals(CAMPAIGN)).toEqual([
          { rewardId: "r1", issued: 2, redeemed: 1 },
          { rewardId: "r2", issued: 1, redeemed: 0 }
        ]);
      });
    });
  });
}
