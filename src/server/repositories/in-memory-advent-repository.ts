import { DomainError } from "@/domain/errors";
import type {
  AdventRepository,
  CompleteLoginInput,
  CompleteLoginResult,
  DayBlockResultRecord,
  DayOpenRecord,
  IdentityRepository,
  LoginTokenRecord,
  ParticipantRecord,
  RewardGrantRecord
} from "@/server/repositories/advent-repository";

/**
 * Реализация в памяти для тестов и `quiz:check`. Методы не содержат `await` между чтением и записью,
 * поэтому в однопоточном Node каждый из них атомарен — как транзакция в PostgreSQL.
 */
export class InMemoryAdventRepository implements AdventRepository, IdentityRepository {
  private readonly participants = new Map<string, ParticipantRecord>();
  /** Хеш ключа cookie → участник (ключ создателя и ключи дополнительных устройств). */
  private readonly keyOwners = new Map<string, string>();
  private readonly opens = new Map<string, DayOpenRecord>();
  private readonly results = new Map<string, DayBlockResultRecord>();
  private readonly grants = new Map<string, RewardGrantRecord>();
  private readonly tokens = new Map<string, LoginTokenRecord>();

  async createParticipant(participant: ParticipantRecord): Promise<ParticipantRecord> {
    if (this.keyOwners.has(participant.accessKeyHash)) throw new Error("Ключ доступа уже занят");
    this.participants.set(participant.id, structuredClone(participant));
    this.keyOwners.set(participant.accessKeyHash, participant.id);
    return structuredClone(participant);
  }

  async getParticipant(participantId: string): Promise<ParticipantRecord | null> {
    const participant = this.participants.get(participantId);
    return participant ? structuredClone(participant) : null;
  }

  async findParticipantByAccessKeyHash(accessKeyHash: string): Promise<ParticipantRecord | null> {
    const id = this.keyOwners.get(accessKeyHash);
    return id ? this.getParticipant(id) : null;
  }

  private requireParticipant(participantId: string): ParticipantRecord {
    const participant = this.participants.get(participantId);
    if (!participant) throw new DomainError("not_found", "Участник не найден.");
    return participant;
  }

  async openDayOnce(participantId: string, day: number, openedAt: Date, onTime: boolean) {
    this.requireParticipant(participantId);
    const key = `${participantId}:${day}`;
    const existing = this.opens.get(key);
    if (existing) return { open: structuredClone(existing), created: false };
    const open = { participantId, day, openedAt, onTime };
    this.opens.set(key, structuredClone(open));
    return { open: structuredClone(open), created: true };
  }

  async listDayOpens(participantId: string): Promise<DayOpenRecord[]> {
    return [...this.opens.values()].filter((open) => open.participantId === participantId).sort((a, b) => a.day - b.day).map((open) => structuredClone(open));
  }

  async recordBlockResultOnce(result: DayBlockResultRecord) {
    this.requireParticipant(result.participantId);
    const key = `${result.participantId}:${result.day}:${result.blockIndex}`;
    const existing = this.results.get(key);
    if (existing) return { result: structuredClone(existing), created: false };
    this.results.set(key, structuredClone(result));
    return { result: structuredClone(result), created: true };
  }

  async listBlockResults(participantId: string): Promise<DayBlockResultRecord[]> {
    return [...this.results.values()]
      .filter((result) => result.participantId === participantId)
      .sort((a, b) => a.day - b.day || a.blockIndex - b.blockIndex)
      .map((result) => structuredClone(result));
  }

  async grantOnce(grant: RewardGrantRecord) {
    this.requireParticipant(grant.participantId);
    const key = `${grant.participantId}:${grant.source}:${grant.day}`;
    const existing = this.grants.get(key);
    if (existing) return { grant: structuredClone(existing), created: false };
    this.grants.set(key, structuredClone(grant));
    return { grant: structuredClone(grant), created: true };
  }

  async listGrants(participantId: string): Promise<RewardGrantRecord[]> {
    return [...this.grants.values()]
      .filter((grant) => grant.participantId === participantId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.day - b.day)
      .map((grant) => structuredClone(grant));
  }

  async mergeParticipants(fromId: string, intoId: string): Promise<void> {
    this.merge(fromId, intoId);
  }

  private merge(fromId: string, intoId: string, moveKeys = true): void {
    if (fromId === intoId) return;
    const from = this.requireParticipant(fromId);
    const into = this.requireParticipant(intoId);
    if (from.campaignSlug !== into.campaignSlug) throw new DomainError("invalid", "Участники из разных кампаний.");
    if (from.normalizedEmail !== null) throw new DomainError("invalid", "Нельзя влить участника, привязанного к email.");

    for (const [key, open] of [...this.opens]) {
      if (open.participantId !== fromId) continue;
      const target = this.opens.get(`${intoId}:${open.day}`);
      if (target) {
        target.openedAt = new Date(Math.min(target.openedAt.getTime(), open.openedAt.getTime()));
        target.onTime = target.onTime || open.onTime;
      } else {
        this.opens.set(`${intoId}:${open.day}`, { ...open, participantId: intoId });
      }
      this.opens.delete(key);
    }
    for (const [key, result] of [...this.results]) {
      if (result.participantId !== fromId) continue;
      const targetKey = `${intoId}:${result.day}:${result.blockIndex}`;
      if (!this.results.has(targetKey)) this.results.set(targetKey, { ...result, participantId: intoId });
      this.results.delete(key);
    }
    for (const [key, grant] of [...this.grants]) {
      if (grant.participantId !== fromId) continue;
      const targetKey = `${intoId}:${grant.source}:${grant.day}`;
      if (!this.grants.has(targetKey)) this.grants.set(targetKey, { ...grant, participantId: intoId });
      this.grants.delete(key);
    }
    for (const [hash, owner] of [...this.keyOwners]) {
      if (owner !== fromId) continue;
      if (moveKeys) this.keyOwners.set(hash, intoId);
      else this.keyOwners.delete(hash);
    }
    // Неиспользованные ссылки входа поглощённого не переходят к итоговому (см. Prisma-реализацию).
    for (const [hash, token] of [...this.tokens]) {
      if (token.participantId === fromId) this.tokens.delete(hash);
    }
    this.participants.delete(fromId);
  }

  async createLoginToken(token: LoginTokenRecord): Promise<void> {
    this.requireParticipant(token.participantId);
    this.tokens.set(token.tokenHash, structuredClone(token));
  }

  async deleteStaleLoginTokens(now: Date): Promise<number> {
    let count = 0;
    for (const [hash, token] of [...this.tokens]) {
      if (token.usedAt === null && token.expiresAt.getTime() >= now.getTime()) continue;
      this.tokens.delete(hash);
      count += 1;
    }
    return count;
  }

  async anonymizeCampaignParticipants(campaignSlug: string): Promise<number> {
    for (const [hash, token] of [...this.tokens]) {
      if (this.participants.get(token.participantId)?.campaignSlug === campaignSlug) this.tokens.delete(hash);
    }
    let count = 0;
    for (const participant of this.participants.values()) {
      if (participant.campaignSlug !== campaignSlug) continue;
      const { normalizedEmail, consentAt, marketingConsentAt, reminderOptIn, unsubscribeHash } = participant;
      if (normalizedEmail === null && consentAt === null && marketingConsentAt === null && !reminderOptIn && unsubscribeHash === null) continue;
      Object.assign(participant, { normalizedEmail: null, consentAt: null, marketingConsentAt: null, reminderOptIn: false, unsubscribeHash: null });
      count += 1;
    }
    return count;
  }

  async completeLogin(input: CompleteLoginInput): Promise<CompleteLoginResult> {
    const token = this.tokens.get(input.tokenHash);
    const requester = token ? this.participants.get(token.participantId) : undefined;
    if (!token || !requester || requester.campaignSlug !== input.campaignSlug) {
      throw new DomainError("invalid", "Ссылка входа недействительна.");
    }
    if (token.usedAt) throw new DomainError("conflict", "Ссылка входа уже использована.");
    if (input.now.getTime() > token.expiresAt.getTime()) throw new DomainError("expired", "Срок действия ссылки истёк.");

    const owner = [...this.participants.values()].find(
      (participant) => participant.campaignSlug === input.campaignSlug && participant.normalizedEmail === token.normalizedEmail
    );
    const target = owner ?? requester;
    token.usedAt = input.now;

    target.normalizedEmail = token.normalizedEmail;
    target.consentAt = target.consentAt ?? token.consentAt;
    target.marketingConsentAt = target.marketingConsentAt ?? token.marketingConsentAt;
    target.reminderOptIn = target.reminderOptIn || token.reminderOptIn;

    const current = input.currentParticipantId ? this.participants.get(input.currentParticipantId) : undefined;
    const sameDevice = input.currentParticipantId === requester.id;
    if (!sameDevice && target.id === requester.id) {
      // Ссылку открыли не на запросившем устройстве: его ключи отзываются (до слияния, чтобы не задеть ключи
      // вливаемого устройства), ключ создателя — ключ этого устройства.
      for (const [hash, owner] of [...this.keyOwners]) if (owner === target.id) this.keyOwners.delete(hash);
      target.accessKeyHash = input.newAccessKeyHash;
    }
    const mergedFrom: string[] = [];
    for (const candidate of new Set([requester.id, current?.id])) {
      const source = candidate ? this.participants.get(candidate) : undefined;
      // Сливаем только анонимных той же кампании; участник с другим email остаётся отдельным.
      if (!source || source.id === target.id || source.normalizedEmail !== null || source.campaignSlug !== target.campaignSlug) continue;
      this.merge(source.id, target.id, source.id !== requester.id || sameDevice);
      mergedFrom.push(source.id);
    }
    this.keyOwners.set(input.newAccessKeyHash, target.id);
    return { participant: structuredClone(target), mergedFrom };
  }
}
