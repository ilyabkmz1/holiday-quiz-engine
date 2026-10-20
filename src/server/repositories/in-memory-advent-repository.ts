import { localDateAt } from "@/domain/advent/calendar";
import { DomainError } from "@/domain/errors";
import {
  GENERATED_CODE_ATTEMPTS,
  SYNTHETIC_EMAIL_DOMAIN,
  type AdventRepository,
  type AnalyticsQuery,
  type AnalyticsRaw,
  type AnalyticsRepository,
  type TeamRaw,
  type AssignCodeResult,
  type CodeSource,
  type GrantWithCampaign,
  type IssueGrantInput,
  type IssueGrantResult,
  type RedeemOutcome,
  type CompleteLoginInput,
  type CompleteLoginResult,
  type DayBlockResultRecord,
  type DayOpenRecord,
  type IdentityRepository,
  type LoginTokenRecord,
  type ParticipantRecord,
  type ReminderCandidateQuery,
  type ReminderClaimInput,
  type ReminderDeliveryRecord,
  type ReminderRepository,
  type ReminderStats,
  type RewardGrantRecord
} from "@/server/repositories/advent-repository";

/**
 * Реализация в памяти для тестов и `quiz:check`. Методы не содержат `await` между чтением и записью,
 * поэтому в однопоточном Node каждый из них атомарен — как транзакция в PostgreSQL.
 */
export class InMemoryAdventRepository implements AdventRepository, IdentityRepository, ReminderRepository, AnalyticsRepository {
  private readonly participants = new Map<string, ParticipantRecord>();
  /** Хеш ключа cookie → участник (ключ создателя и ключи дополнительных устройств). */
  private readonly keyOwners = new Map<string, string>();
  private readonly opens = new Map<string, DayOpenRecord>();
  private readonly results = new Map<string, DayBlockResultRecord>();
  private readonly grants = new Map<string, RewardGrantRecord>();
  private readonly tokens = new Map<string, LoginTokenRecord>();
  /** Доставки напоминаний: ключ `участник:день`. */
  private readonly deliveries = new Map<string, ReminderDeliveryRecord>();
  /** Пул кодов: ключ `кампания|код` (уникальность, как `@@unique([campaignSlug, code])`). */
  private readonly codes = new Map<string, { campaignSlug: string; rewardId: string; code: string; grantId: string | null }>();
  /** Остатки: ключ `кампания|награда`. */
  private readonly stock = new Map<string, number>();

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

  private releaseCodes(grantId: string): void {
    for (const row of this.codes.values()) if (row.grantId === grantId) row.grantId = null;
  }

  private campaignOf(participantId: string): string {
    return this.requireParticipant(participantId).campaignSlug;
  }

  private grantById(grantId: string): RewardGrantRecord | undefined {
    return [...this.grants.values()].find((grant) => grant.id === grantId);
  }

  /** Берёт код источника для выдачи или `null`, если свободного кода в пуле нет. */
  private takeCode(campaignSlug: string, grant: RewardGrantRecord, source: CodeSource): string | null {
    if (source.kind === "static") return source.code;
    if (source.kind === "list") {
      const free = [...this.codes.values()]
        .filter((row) => row.campaignSlug === campaignSlug && row.rewardId === grant.rewardId && row.grantId === null)
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))[0];
      if (!free) return null;
      free.grantId = grant.id;
      return free.code;
    }
    for (let attempt = 0; attempt < GENERATED_CODE_ATTEMPTS; attempt += 1) {
      const code = source.next();
      const key = `${campaignSlug}|${code}`;
      if (this.codes.has(key)) continue;
      this.codes.set(key, { campaignSlug, rewardId: grant.rewardId, code, grantId: grant.id });
      return code;
    }
    throw new Error("Не удалось подобрать уникальный код награды");
  }

  async issueGrant(input: IssueGrantInput): Promise<IssueGrantResult> {
    const { grant, campaignSlug } = input;
    this.requireParticipant(grant.participantId);
    const key = `${grant.participantId}:${grant.source}:${grant.day}`;
    const existing = this.grants.get(key);
    if (existing) return { status: "existing", grant: structuredClone(existing), codeMissing: existing.code === null && input.code !== null };
    const stockKey = `${campaignSlug}|${grant.rewardId}`;
    if (input.consumeStock) {
      const left = this.stock.get(stockKey);
      if (left === undefined || left <= 0) return { status: "stock_exhausted" };
    }
    const stored: RewardGrantRecord = { ...structuredClone(grant), code: null };
    this.grants.set(key, stored);
    let code: string | null = null;
    if (input.code) {
      code = this.takeCode(campaignSlug, stored, input.code);
      if (code === null && input.requireCode) {
        this.grants.delete(key); // откат: ни выдачи, ни списания
        return { status: "pool_empty" };
      }
      stored.code = code;
    }
    if (input.consumeStock) this.stock.set(stockKey, this.stock.get(stockKey)! - 1);
    return { status: "created", grant: structuredClone(stored), codeMissing: input.code !== null && code === null };
  }

  async assignGrantCode(grantId: string, source: CodeSource | null, expiresAt: Date | null): Promise<AssignCodeResult> {
    const grant = this.grantById(grantId);
    if (!grant) throw new DomainError("not_found", "Выдача не найдена.");
    if (source === null) {
      if (grant.expiresAt !== null || expiresAt === null) return { grant: structuredClone(grant), status: "existing" };
      grant.expiresAt = expiresAt;
      return { grant: structuredClone(grant), status: "assigned" };
    }
    if (grant.code !== null) return { grant: structuredClone(grant), status: "existing" };
    const code = this.takeCode(this.campaignOf(grant.participantId), grant, source);
    if (code === null) return { grant: structuredClone(grant), status: "pool_empty" };
    grant.code = code;
    if (expiresAt !== null) grant.expiresAt = expiresAt;
    return { grant: structuredClone(grant), status: "assigned" };
  }

  async getGrant(grantId: string): Promise<GrantWithCampaign | null> {
    const grant = this.grantById(grantId);
    return grant ? { ...structuredClone(grant), campaignSlug: this.campaignOf(grant.participantId) } : null;
  }

  async findGrantsByCode(campaignSlug: string, code: string): Promise<RewardGrantRecord[]> {
    const wanted = code.toLowerCase();
    return [...this.grants.values()]
      .filter((grant) => grant.code?.toLowerCase() === wanted && this.campaignOf(grant.participantId) === campaignSlug)
      .map((grant) => structuredClone(grant));
  }

  async redeemGrant(campaignSlug: string, grantId: string, now: Date): Promise<RedeemOutcome> {
    const grant = this.grantById(grantId);
    if (!grant || this.campaignOf(grant.participantId) !== campaignSlug) return { status: "not_found" };
    if (grant.status === "redeemed") return { status: "already_redeemed", grant: structuredClone(grant) };
    if (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()) return { status: "expired", grant: structuredClone(grant) };
    grant.status = "redeemed";
    grant.redeemedAt = now;
    return { status: "redeemed", grant: structuredClone(grant) };
  }

  async ensureStock(campaignSlug: string, items: ReadonlyArray<{ rewardId: string; left: number }>): Promise<void> {
    for (const item of items) {
      const key = `${campaignSlug}|${item.rewardId}`;
      if (!this.stock.has(key)) this.stock.set(key, item.left);
    }
  }

  async stockLeft(campaignSlug: string): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const [key, left] of this.stock) if (key.startsWith(`${campaignSlug}|`)) result[key.slice(campaignSlug.length + 1)] = left;
    return result;
  }

  async importCodes(campaignSlug: string, rewardId: string, codes: readonly string[]): Promise<{ added: number; duplicates: number }> {
    let added = 0;
    let duplicates = 0;
    for (const code of codes) {
      const key = `${campaignSlug}|${code}`;
      if (this.codes.has(key)) {
        duplicates += 1;
        continue;
      }
      this.codes.set(key, { campaignSlug, rewardId, code, grantId: null });
      added += 1;
    }
    return { added, duplicates };
  }

  async poolOverview(campaignSlug: string): Promise<Record<string, { total: number; free: number }>> {
    const result: Record<string, { total: number; free: number }> = {};
    for (const row of this.codes.values()) {
      if (row.campaignSlug !== campaignSlug) continue;
      const entry = (result[row.rewardId] ??= { total: 0, free: 0 });
      entry.total += 1;
      if (row.grantId === null) entry.free += 1;
    }
    return result;
  }

  async listCampaignGrants(campaignSlug: string): Promise<RewardGrantRecord[]> {
    return [...this.grants.values()]
      .filter((grant) => this.campaignOf(grant.participantId) === campaignSlug)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map((grant) => structuredClone(grant));
  }

  async grantTotals(campaignSlug: string): Promise<Array<{ rewardId: string; issued: number; redeemed: number }>> {
    const totals = new Map<string, { rewardId: string; issued: number; redeemed: number }>();
    for (const grant of await this.listCampaignGrants(campaignSlug)) {
      const entry = totals.get(grant.rewardId) ?? { rewardId: grant.rewardId, issued: 0, redeemed: 0 };
      entry.issued += 1;
      if (grant.status === "redeemed") entry.redeemed += 1;
      totals.set(grant.rewardId, entry);
    }
    return [...totals.values()].sort((a, b) => a.rewardId.localeCompare(b.rewardId));
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
    if (into.teamId === null && from.teamId !== null) into.teamId = from.teamId;

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
      else this.releaseCodes(grant.id); // дубль удаляется, его код возвращается в пул (в БД — ON DELETE SET NULL)
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
    for (const [key, delivery] of [...this.deliveries]) {
      if (delivery.participantId === fromId) this.deliveries.delete(key);
    }
    this.participants.delete(fromId);
  }

  private canRemind(participant: ParticipantRecord, day: number): boolean {
    return (
      participant.reminderOptIn &&
      participant.normalizedEmail !== null &&
      participant.consentAt !== null &&
      participant.marketingConsentAt !== null &&
      !this.opens.has(`${participant.id}:${day}`)
    );
  }

  private retryable(delivery: ReminderDeliveryRecord, retryBefore: Date, maxAttempts: number): boolean {
    return delivery.status === "failed" && delivery.attempts < maxAttempts && delivery.lastAttemptAt.getTime() < retryBefore.getTime();
  }

  async listReminderCandidates(query: ReminderCandidateQuery): Promise<ParticipantRecord[]> {
    return [...this.participants.values()]
      .filter((participant) => participant.campaignSlug === query.campaignSlug && this.canRemind(participant, query.day))
      .filter((participant) => !participant.normalizedEmail?.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`))
      .filter((participant) => {
        const delivery = this.deliveries.get(`${participant.id}:${query.day}`);
        return !delivery || this.retryable(delivery, query.retryBefore, query.maxAttempts);
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, query.limit)
      .map((participant) => structuredClone(participant));
  }

  async claimReminder(input: ReminderClaimInput): Promise<ReminderDeliveryRecord | null> {
    const participant = this.participants.get(input.participantId);
    if (!participant || !this.canRemind(participant, input.day)) return null;
    const key = `${input.participantId}:${input.day}`;
    const existing = this.deliveries.get(key);
    let delivery: ReminderDeliveryRecord;
    if (!existing) {
      delivery = {
        id: input.deliveryId,
        participantId: input.participantId,
        day: input.day,
        status: "sending",
        attempts: 1,
        lastError: null,
        claimedAt: input.now,
        lastAttemptAt: input.now,
        sentAt: null,
        clickedAt: null,
        unsubscribeHash: input.unsubscribeHash
      };
    } else if (this.retryable(existing, input.retryBefore, input.maxAttempts)) {
      delivery = { ...existing, id: input.deliveryId, status: "sending", attempts: existing.attempts + 1, lastError: null, claimedAt: input.now, lastAttemptAt: input.now, unsubscribeHash: input.unsubscribeHash };
    } else {
      return null;
    }
    this.deliveries.set(key, delivery);
    participant.unsubscribeHash = input.unsubscribeHash;
    return structuredClone(delivery);
  }

  private deliveryById(deliveryId: string): ReminderDeliveryRecord | undefined {
    return [...this.deliveries.values()].find((delivery) => delivery.id === deliveryId);
  }

  async markReminderSent(deliveryId: string, now: Date): Promise<void> {
    const delivery = this.deliveryById(deliveryId);
    if (delivery?.status === "sending") Object.assign(delivery, { status: "sent", sentAt: now, lastError: null });
  }

  async markReminderFailed(deliveryId: string, errorCode: string): Promise<void> {
    const delivery = this.deliveryById(deliveryId);
    if (delivery?.status === "sending") Object.assign(delivery, { status: "failed", lastError: errorCode.slice(0, 64) });
  }

  async getReminderDelivery(deliveryId: string): Promise<ReminderDeliveryRecord | null> {
    const delivery = this.deliveryById(deliveryId);
    return delivery ? structuredClone(delivery) : null;
  }

  async recordReminderClick(deliveryId: string, now: Date): Promise<ReminderDeliveryRecord | null> {
    const delivery = this.deliveryById(deliveryId);
    if (!delivery) return null;
    delivery.clickedAt ??= now;
    return structuredClone(delivery);
  }

  async findParticipantByUnsubscribeHash(hash: string): Promise<ParticipantRecord | null> {
    const direct = [...this.participants.values()].find((participant) => participant.unsubscribeHash === hash);
    const owner = direct ?? this.participants.get([...this.deliveries.values()].find((delivery) => delivery.unsubscribeHash === hash)?.participantId ?? "");
    return owner ? structuredClone(owner) : null;
  }

  async setReminderOptIn(participantId: string, enabled: boolean, now: Date): Promise<ParticipantRecord | null> {
    const participant = this.participants.get(participantId);
    if (!participant) return null;
    if (enabled) {
      participant.reminderOptIn = true;
      participant.unsubscribedAt = null;
      participant.marketingConsentAt ??= now;
    } else if (participant.reminderOptIn || participant.marketingConsentAt !== null) {
      participant.reminderOptIn = false;
      participant.marketingConsentAt = null;
      participant.unsubscribedAt = now;
    }
    return structuredClone(participant);
  }

  async reminderStats(campaignSlug: string): Promise<ReminderStats> {
    const byDay = new Map<number, ReminderStats["days"][number]>();
    for (const delivery of this.deliveries.values()) {
      if (this.participants.get(delivery.participantId)?.campaignSlug !== campaignSlug) continue;
      const row = byDay.get(delivery.day) ?? { day: delivery.day, sent: 0, failed: 0, clicked: 0, openedAfter: 0 };
      if (delivery.status === "sent") row.sent += 1;
      else row.failed += 1;
      if (delivery.clickedAt) row.clicked += 1;
      const open = this.opens.get(`${delivery.participantId}:${delivery.day}`);
      if (delivery.status === "sent" && delivery.sentAt && open && open.openedAt.getTime() >= delivery.sentAt.getTime()) row.openedAfter += 1;
      byDay.set(delivery.day, row);
    }
    const people = [...this.participants.values()].filter((participant) => participant.campaignSlug === campaignSlug);
    return {
      days: [...byDay.values()].sort((a, b) => a.day - b.day),
      subscribed: people.filter((participant) => participant.reminderOptIn && participant.normalizedEmail !== null && participant.marketingConsentAt !== null).length,
      unsubscribed: people.filter((participant) => !participant.reminderOptIn && participant.unsubscribedAt !== null).length
    };
  }

  async setParticipantTeam(participantId: string, teamId: string | null): Promise<ParticipantRecord | null> {
    const participant = this.participants.get(participantId);
    if (!participant) return null;
    participant.teamId = teamId;
    return structuredClone(participant);
  }

  async analyticsRaw(query: AnalyticsQuery): Promise<AnalyticsRaw> {
    const people = [...this.participants.values()].filter((participant) => participant.campaignSlug === query.campaignSlug);
    const ids = new Set(people.map((participant) => participant.id));
    const opens = [...this.opens.values()].filter((open) => ids.has(open.participantId));
    const opensBy = new Map<string, DayOpenRecord[]>();
    for (const open of opens) opensBy.set(open.participantId, [...(opensBy.get(open.participantId) ?? []), open]);
    const sortedOpens = (id: string) => (opensBy.get(id) ?? []).sort((a, b) => a.day - b.day);
    const firstOpenAt = (id: string): number => Math.min(...sortedOpens(id).map((open) => open.openedAt.getTime()));

    const perDay = new Map<number, { onTime: number; caughtUp: number }>();
    for (const open of opens) {
      const row = perDay.get(open.day) ?? { onTime: 0, caughtUp: 0 };
      if (open.onTime) row.onTime += 1;
      else row.caughtUp += 1;
      perDay.set(open.day, row);
    }

    const blocksBy = new Map<string, number>();
    for (const result of this.results.values()) {
      if (ids.has(result.participantId)) blocksBy.set(`${result.participantId}:${result.day}`, (blocksBy.get(`${result.participantId}:${result.day}`) ?? 0) + 1);
    }
    const completed = new Map<number, number>();
    for (const [key, count] of blocksBy) {
      const day = Number(key.split(":")[1]);
      if (query.windows.some((window) => window.day === day && window.blocks === count)) completed.set(day, (completed.get(day) ?? 0) + 1);
    }

    const players = people.filter((participant) => opensBy.has(participant.id));
    const histogram = new Map<number, number>();
    const patterns = new Map<string, { days: number[]; count: number }>();
    for (const participant of players) {
      const own = sortedOpens(participant.id);
      histogram.set(own.length, (histogram.get(own.length) ?? 0) + 1);
      const days = own.filter((open) => open.onTime).map((open) => open.day);
      const key = days.join(",");
      patterns.set(key, { days, count: (patterns.get(key)?.count ?? 0) + 1 });
    }

    const cohorts = new Map<string, { size: number; returned: Map<number, number> }>();
    for (const participant of people) {
      const date = localDateAt(participant.createdAt, query.timezone);
      const cohort = cohorts.get(date) ?? { size: 0, returned: new Map<number, number>() };
      cohort.size += 1;
      const openDates = new Set(sortedOpens(participant.id).map((open) => localDateAt(open.openedAt, query.timezone)));
      for (const offset of query.retentionOffsets) {
        const target = new Date(`${date}T00:00:00Z`);
        target.setUTCDate(target.getUTCDate() + offset);
        if (openDates.has(target.toISOString().slice(0, 10))) cohort.returned.set(offset, (cohort.returned.get(offset) ?? 0) + 1);
      }
      cohorts.set(date, cohort);
    }

    const grants = new Map<string, AnalyticsRaw["grants"][number]>();
    for (const grant of this.grants.values()) {
      if (!ids.has(grant.participantId)) continue;
      const key = `${grant.rewardId}|${grant.source}`;
      const row = grants.get(key) ?? { rewardId: grant.rewardId, source: grant.source, issued: 0, redeemed: 0, expired: 0, withoutCode: 0 };
      row.issued += 1;
      if (grant.status === "redeemed") row.redeemed += 1;
      if (grant.status === "issued" && grant.expiresAt !== null && grant.expiresAt.getTime() <= query.now.getTime()) row.expired += 1;
      if (grant.code === null) row.withoutCode += 1;
      grants.set(key, row);
    }

    return {
      participants: people.length,
      players: players.length,
      withEmail: people.filter((participant) => participant.normalizedEmail !== null).length,
      withConsent: people.filter((participant) => participant.consentAt !== null).length,
      withMarketing: people.filter((participant) => participant.marketingConsentAt !== null).length,
      withReminders: people.filter((participant) => participant.reminderOptIn && participant.normalizedEmail !== null && participant.marketingConsentAt !== null).length,
      opens: [...perDay].sort((a, b) => a[0] - b[0]).map(([day, row]) => ({ day, ...row })),
      completed: [...completed].sort((a, b) => a[0] - b[0]).map(([day, count]) => ({ day, count })),
      activeByDay: query.windows.map((window) => {
        const active = players.filter((participant) => firstOpenAt(participant.id) < window.end.getTime());
        return { day: window.day, active: active.length, opened: active.filter((participant) => sortedOpens(participant.id).some((open) => open.day === window.day)).length };
      }),
      doorsHistogram: [...histogram].sort((a, b) => a[0] - b[0]).map(([doors, count]) => ({ doors, count })),
      onTimePatterns: [...patterns.values()],
      cohorts: [...cohorts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, cohort]) => ({
        date,
        size: cohort.size,
        returned: [...cohort.returned].sort((a, b) => a[0] - b[0]).map(([offset, count]) => ({ offset, count }))
      })),
      activeToday: players.filter((participant) => sortedOpens(participant.id).some((open) => localDateAt(open.openedAt, query.timezone) === query.today)).length,
      grants: [...grants.values()].sort((a, b) => (a.rewardId + a.source < b.rewardId + b.source ? -1 : 1))
    };
  }

  async teamStats(campaignSlug: string): Promise<TeamRaw[]> {
    const teams = new Map<string, TeamRaw>();
    for (const participant of this.participants.values()) {
      if (participant.campaignSlug !== campaignSlug || participant.teamId === null) continue;
      const row = teams.get(participant.teamId) ?? { teamId: participant.teamId, members: 0, players: 0, doors: 0, points: 0 };
      const doors = [...this.opens.values()].filter((open) => open.participantId === participant.id).length;
      row.members += 1;
      if (doors > 0) row.players += 1;
      row.doors += doors;
      row.points += [...this.results.values()].filter((result) => result.participantId === participant.id).reduce((sum, result) => sum + result.points, 0);
      teams.set(participant.teamId, row);
    }
    return [...teams.values()].sort((a, b) => (a.teamId < b.teamId ? -1 : 1));
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
    for (const delivery of this.deliveries.values()) {
      if (this.participants.get(delivery.participantId)?.campaignSlug === campaignSlug) delivery.unsubscribeHash = null;
    }
    let count = 0;
    for (const participant of this.participants.values()) {
      if (participant.campaignSlug !== campaignSlug) continue;
      const { normalizedEmail, consentAt, marketingConsentAt, reminderOptIn, unsubscribeHash, unsubscribedAt } = participant;
      if (normalizedEmail === null && consentAt === null && marketingConsentAt === null && !reminderOptIn && unsubscribeHash === null && unsubscribedAt === null) continue;
      Object.assign(participant, { normalizedEmail: null, consentAt: null, marketingConsentAt: null, reminderOptIn: false, unsubscribeHash: null, unsubscribedAt: null });
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
    if (token.reminderOptIn && !target.reminderOptIn) target.unsubscribedAt = null;
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
