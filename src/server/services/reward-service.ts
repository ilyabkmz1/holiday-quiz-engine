import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import type { AdventConfig, AdventReward } from "@/config/advent-schema";
import { drawLuck, generateRewardCode, luckSeed, rewardExpiresAt, type LuckPoolItem } from "@/domain/advent";
import { DomainError } from "@/domain/errors";
import { createId } from "@/server/crypto";
import type { AdventRepository, CodeSource, GrantSource, IssueGrantResult, ParticipantRecord, RewardGrantRecord } from "@/server/repositories/advent-repository";

/** Префикс и версия содержимого личного QR кассового погашения: `ADV1.<id выдачи>.<подпись>`. */
export const QR_PREFIX = "ADV1";
/** Подпись QR: 16 байт HMAC-SHA256 в base64url (22 символа) — достаточно против подбора, QR остаётся небольшим. */
const QR_MAC_LENGTH = 22;
/** Ограничения импорта кодов: размер файла и число строк. */
export const CODE_IMPORT_LIMITS = { bytes: 2_000_000, rows: 50_000 } as const;
/** Допустимый вид кода из CSV: буквы, цифры, дефис и подчёркивание; регистр не различается (хранится в верхнем). */
export const IMPORTED_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;
/** Секрет подписи, если `REWARD_QR_SECRET` не задан вне production (в production запуск без него не проходит проверку). */
const DEV_QR_SECRET = "dev-only-reward-qr-secret-do-not-use-in-production";

export type RewardAudit = (event: string, entityId: string | null, metadata?: Record<string, string | number | boolean | null>) => Promise<void>;

export type RewardServiceOptions = {
  /** Секрет подписи личного QR (`REWARD_QR_SECRET`). Без него QR не выдаётся. */
  qrSecret?: string;
  /** Публичный адрес арендатора: из него строится ссылка `/redeem?code=…` для QR. */
  baseUrl?: string;
  /** Источник случайности для сгенерированных кодов, [0, 1). По умолчанию криптостойкий. */
  rng?: () => number;
  /** Журнал событий без персональных данных (в `AuditEvent`). */
  audit?: RewardAudit;
};

/** Нужен ли участнику подтверждённый email: награда с кодом, остатком или погашением на кассе выдаётся только после входа по ссылке. */
export function rewardNeedsIdentity(reward: Pick<AdventReward, "codes" | "stock" | "redeem"> | undefined): boolean {
  if (!reward) return false;
  return reward.codes !== undefined || reward.stock !== undefined || reward.redeem === "cashier" || reward.redeem === "both";
}

export function isCashierRedeemable(reward: Pick<AdventReward, "redeem"> | undefined): boolean {
  return reward?.redeem === "cashier" || reward?.redeem === "both";
}

export function isVerified(participant: Pick<ParticipantRecord, "normalizedEmail">): boolean {
  return participant.normalizedEmail !== null;
}

function cryptoRng(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32;
}

/** Код из CSV-ячейки: пробелы по краям убираются, регистр приводится к верхнему. */
export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Разбор CSV (RFC 4180: кавычки, `""`, переводы строк внутри кавычек). Разделитель — запятая или точка с запятой. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ""));
}

export type ImportReport = {
  /** Строк с кодами в файле (без заголовка). */
  rows: number;
  added: number;
  /** Повтор внутри самого файла. */
  duplicatesInFile: number;
  /** Код уже есть в кампании (в этой или другой награде). */
  alreadyInPool: number;
  /** Не прошли проверку вида кода. */
  invalid: number;
};

export type RedeemGrantInfo = {
  grantId: string;
  rewardId: string;
  label: string;
  description: string;
  day: number;
  source: GrantSource;
  expiresAt: Date | null;
  redeemedAt: Date | null;
};

/** Причины, по которым гасить нечего; одинаковы для предпросмотра и погашения. */
export type RedeemRefusal =
  /** QR не распознан или подпись неверна. */
  | { status: "invalid" }
  /** Код не найден (или принадлежит другой кампании). */
  | { status: "not_found" }
  /** Награда не гасится на кассе (`redeem` не `cashier`/`both`). */
  | { status: "not_redeemable"; label: string }
  /** Общий код (`static`) на кассе гасится только по личному QR. */
  | { status: "needs_qr"; label: string }
  /** Выдача ещё без кода (пустой пул): гасить нечего. */
  | { status: "pending"; label: string };

export type RedeemInspection = (RedeemGrantInfo & { status: "ready" | "redeemed" | "expired" }) | RedeemRefusal;
export type RedeemResult = (RedeemGrantInfo & { status: "redeemed" | "already_redeemed" | "expired" }) | RedeemRefusal;

export class RewardService {
  private readonly rng: () => number;

  constructor(
    private readonly repository: AdventRepository,
    private readonly advent: AdventConfig,
    private readonly options: RewardServiceOptions = {}
  ) {
    this.rng = options.rng ?? cryptoRng;
  }

  private get rewardsById(): Map<string, AdventReward> {
    return new Map(this.advent.rewards.map((reward) => [reward.id, reward]));
  }

  reward(rewardId: string): AdventReward | undefined {
    return this.advent.rewards.find((reward) => reward.id === rewardId);
  }

  private audit(event: string, entityId: string | null, metadata?: Record<string, string | number | boolean | null>): Promise<void> {
    return (this.options.audit?.(event, entityId, metadata) ?? Promise.resolve()).catch(() => undefined);
  }

  /** Источник кода награды или `null`, если у награды нет кодов. */
  codeSourceFor(reward: AdventReward | undefined): CodeSource | null {
    const codes = reward?.codes;
    if (!codes) return null;
    if ("static" in codes) return { kind: "static", code: codes.static };
    if ("list" in codes) return { kind: "list" };
    const { prefix, length } = codes.generated;
    return { kind: "generated", next: () => generateRewardCode(prefix, length, this.rng) };
  }

  /**
   * Выдаёт награду идемпотентно по (участник, источник, день). Код и остаток — одной транзакцией репозитория.
   * Анонимному участнику награда, требующая входа (`rewardNeedsIdentity`), записывается без кода и без срока:
   * код и срок появятся при подтверждении email (`ensureCodes`).
   */
  async issue(
    participant: ParticipantRecord,
    source: GrantSource,
    day: number,
    rewardId: string,
    now: Date,
    options: { consumeStock?: boolean; requireCode?: boolean } = {}
  ): Promise<IssueGrantResult> {
    const reward = this.reward(rewardId);
    const gated = rewardNeedsIdentity(reward) && !isVerified(participant);
    const grant: RewardGrantRecord = {
      id: createId(),
      participantId: participant.id,
      day,
      source,
      rewardId,
      code: null,
      expiresAt: reward && !gated ? rewardExpiresAt(now, reward) : null,
      status: "issued",
      redeemedAt: null,
      createdAt: now
    };
    const result = await this.repository.issueGrant({
      grant,
      campaignSlug: this.advent.slug,
      consumeStock: Boolean(options.consumeStock) && reward?.stock !== undefined && !gated,
      code: gated ? null : this.codeSourceFor(reward),
      requireCode: Boolean(options.requireCode)
    });
    if (result.status === "created" && result.codeMissing) await this.audit("reward_pool_empty", result.grant.id, { rewardId, campaign: this.advent.slug });
    return result;
  }

  /** Выдаче не хватает кода (награда с кодами) или срока (награда без кодов, но с входом и сроком): её нужно активировать. */
  needsActivation(grant: RewardGrantRecord): boolean {
    const reward = this.reward(grant.rewardId);
    if (!reward || grant.status !== "issued") return false;
    if (reward.codes !== undefined) return grant.code === null;
    return rewardNeedsIdentity(reward) && grant.expiresAt === null && reward.validDays !== undefined;
  }

  /**
   * Дозаполняет код (и срок) у выдач подтверждённого участника: выданных анонимно до входа по ссылке и тех,
   * что остались без кода при пустом пуле. Идемпотентно: выдача с кодом не меняется, повторный вызов безопасен.
   * `notify` пишет событие `reward_pool_empty` (без персональных данных), если пул по-прежнему пуст.
   */
  async ensureCodes(participant: ParticipantRecord, grants: readonly RewardGrantRecord[], now: Date, notify = false): Promise<RewardGrantRecord[]> {
    if (!isVerified(participant)) return [...grants];
    const result: RewardGrantRecord[] = [];
    for (const grant of grants) {
      const reward = this.reward(grant.rewardId);
      if (!reward || !this.needsActivation(grant)) {
        result.push(grant);
        continue;
      }
      const outcome = await this.repository.assignGrantCode(grant.id, this.codeSourceFor(reward), rewardExpiresAt(now, reward));
      if (outcome.status === "pool_empty" && notify) await this.audit("reward_pool_empty", grant.id, { rewardId: grant.rewardId, campaign: this.advent.slug });
      result.push(outcome.grant);
    }
    return result;
  }

  /**
   * Розыгрыш удачи для дня `day`. Детерминирован (`luckSeed`) и идемпотентен: повтор возвращает ту же выдачу.
   * Остатки призов создаются лениво (`ensureStock`, `ON CONFLICT DO NOTHING`) при первом розыгрыше кампании.
   * Приз без остатка или без свободного кода исключается и разыгрывается заново; гарантирует исход `luck.fallbackRewardId`.
   */
  async playLuck(participant: ParticipantRecord, day: number, pool: readonly LuckPoolItem[], now: Date): Promise<RewardGrantRecord> {
    const existing = (await this.repository.listGrants(participant.id)).find((grant) => grant.source === "luck" && grant.day === day);
    if (existing) return existing;

    await this.repository.ensureStock(
      this.advent.slug,
      this.advent.rewards.filter((reward) => reward.stock !== undefined).map((reward) => ({ rewardId: reward.id, left: reward.stock! }))
    );
    const fallbackRewardId = this.advent.luck?.fallbackRewardId;
    const seed = luckSeed(this.advent.slug, participant.id, day);
    const excluded = new Set<string>();

    for (let attempt = 0; attempt <= pool.length; attempt += 1) {
      const [stock, codePools] = await Promise.all([this.repository.stockLeft(this.advent.slug), this.repository.poolOverview(this.advent.slug)]);
      const left: Record<string, number> = {};
      for (const item of pool) {
        const reward = this.reward(item.rewardId);
        const limits: number[] = [];
        if (reward?.stock !== undefined) limits.push(stock[reward.id] ?? 0);
        if (reward?.codes && "list" in reward.codes) limits.push(codePools[reward.id]?.free ?? 0);
        if (limits.length > 0) left[item.rewardId] = Math.min(...limits);
        if (excluded.has(item.rewardId)) left[item.rewardId] = 0;
      }
      let rewardId: string;
      try {
        rewardId = drawLuck(pool, left, seed, fallbackRewardId);
      } catch {
        throw new DomainError("conflict", "Призы удачи закончились.");
      }
      const reward = this.reward(rewardId);
      const result = await this.issue(participant, "luck", day, rewardId, now, {
        consumeStock: reward?.stock !== undefined,
        // Гарантированный исход выдаётся и при пустом пуле кодов: остаться без приза нельзя.
        requireCode: rewardId !== fallbackRewardId
      });
      if (result.status === "created" || result.status === "existing") return result.grant;
      excluded.add(rewardId);
    }
    throw new DomainError("conflict", "Призы удачи закончились.");
  }

  // ---------------------------------------------------------------- Личный QR

  private macOf(grantId: string): string | null {
    const secret = this.options.qrSecret ?? (process.env.NODE_ENV === "production" ? undefined : DEV_QR_SECRET);
    if (!secret) return null;
    return createHmac("sha256", secret).update(`advent-redeem:v1:${this.advent.slug}:${grantId}`).digest("base64url").slice(0, QR_MAC_LENGTH);
  }

  /** Содержимое личного QR для выдачи или `null`, если секрет не задан. Не выдаётся тому, кто не может погасить награду. */
  qr(grant: RewardGrantRecord): { payload: string; url: string | null } | null {
    const reward = this.reward(grant.rewardId);
    if (!isCashierRedeemable(reward) || grant.status !== "issued") return null;
    if (reward?.codes && grant.code === null) return null;
    const mac = this.macOf(grant.id);
    if (!mac) return null;
    const payload = `${QR_PREFIX}.${grant.id}.${mac}`;
    const url = this.options.baseUrl ? `${this.options.baseUrl.replace(/\/$/, "")}/redeem?code=${encodeURIComponent(payload)}` : null;
    return { payload, url };
  }

  private verifyMac(grantId: string, mac: string): boolean {
    const expected = this.macOf(grantId);
    if (!expected || mac.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  }

  /** Что ввёл кассир: содержимое QR (в том числе в виде ссылки `…/redeem?code=…`) или текстовый код. */
  parseRedeemInput(raw: string): { kind: "qr"; grantId: string; mac: string } | { kind: "code"; code: string } | { kind: "empty" } {
    let text = raw.trim();
    if (text === "") return { kind: "empty" };
    if (/^https?:\/\//i.test(text)) {
      try {
        text = new URL(text).searchParams.get("code")?.trim() ?? "";
      } catch {
        return { kind: "empty" };
      }
      if (text === "") return { kind: "empty" };
    }
    const qr = new RegExp(`^${QR_PREFIX}\\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.([A-Za-z0-9_-]+)$`, "i").exec(text);
    if (qr) return { kind: "qr", grantId: qr[1].toLowerCase(), mac: qr[2] };
    if (text.startsWith(`${QR_PREFIX}.`)) return { kind: "qr", grantId: "", mac: "" };
    return { kind: "code", code: text.replace(/\s+/g, "") };
  }

  // ---------------------------------------------------------------- Касса

  private async resolveGrant(input: string): Promise<RedeemRefusal | { grant: RewardGrantRecord; reward: AdventReward }> {
    const parsed = this.parseRedeemInput(input);
    if (parsed.kind === "empty") return { status: "not_found" };
    let grant: RewardGrantRecord | undefined;
    if (parsed.kind === "qr") {
      if (!parsed.grantId || !this.verifyMac(parsed.grantId, parsed.mac)) return { status: "invalid" };
      const found = await this.repository.getGrant(parsed.grantId);
      if (found && found.campaignSlug === this.advent.slug) grant = found;
    } else {
      const found = await this.repository.findGrantsByCode(this.advent.slug, parsed.code);
      if (found.length === 0) return { status: "not_found" };
      const first = this.reward(found[0].rewardId);
      // Общий код у всех гостей один: по тексту не понять, чья это выдача, нужен личный QR.
      if (found.length > 1 || (first?.codes && "static" in first.codes)) return { status: "needs_qr", label: first?.label ?? found[0].rewardId };
      grant = found[0];
    }
    if (!grant) return { status: "not_found" };
    const reward = this.reward(grant.rewardId);
    if (!reward) return { status: "not_found" };
    if (!isCashierRedeemable(reward)) return { status: "not_redeemable", label: reward.label };
    if (reward.codes && grant.code === null) return { status: "pending", label: reward.label };
    return { grant, reward };
  }

  private info(grant: RewardGrantRecord, reward: AdventReward): RedeemGrantInfo {
    return {
      grantId: grant.id,
      rewardId: reward.id,
      label: reward.label,
      description: reward.description,
      day: grant.day,
      source: grant.source,
      expiresAt: grant.expiresAt,
      redeemedAt: grant.redeemedAt
    };
  }

  /** Предпросмотр для кассы: ничего не меняет. Срок проверяется по `now`. */
  async inspect(input: string, now: Date): Promise<RedeemInspection> {
    const resolved = await this.resolveGrant(input);
    if (!("grant" in resolved)) return resolved;
    const { grant, reward } = resolved;
    const expired = grant.status === "issued" && grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime();
    return { ...this.info(grant, reward), status: grant.status === "redeemed" ? "redeemed" : expired ? "expired" : "ready" };
  }

  /** Погашение: один условный UPDATE (см. `AdventRepository.redeemGrant`). Повтор и просрочка отвечают своим статусом. */
  async redeem(input: string, now: Date): Promise<RedeemResult> {
    const resolved = await this.resolveGrant(input);
    if (!("grant" in resolved)) return resolved;
    const { grant, reward } = resolved;
    const outcome = await this.repository.redeemGrant(this.advent.slug, grant.id, now);
    if (outcome.status === "not_found") return { status: "not_found" };
    if (outcome.status === "redeemed") await this.audit("reward_redeemed", outcome.grant.id, { rewardId: reward.id, campaign: this.advent.slug });
    return { ...this.info(outcome.grant, reward), status: outcome.status };
  }

  // ---------------------------------------------------------------- Админка

  /**
   * Импорт кодов в пул награды из CSV со столбцом `code` (заголовок обязателен; остальные столбцы игнорируются).
   * Коды приводятся к верхнему регистру, дубли внутри файла и уже имеющиеся в кампании пропускаются и считаются в отчёте.
   */
  async importCodes(rewardId: string, csv: string): Promise<ImportReport> {
    const reward = this.reward(rewardId);
    if (!reward) throw new DomainError("not_found", "Награда не найдена.");
    if (!reward.codes || !("list" in reward.codes)) throw new DomainError("invalid", "У награды нет списка кодов (codes.list).");
    if (csv.length > CODE_IMPORT_LIMITS.bytes) throw new DomainError("invalid", "Файл слишком большой.");
    const rows = parseCsv(csv);
    const header = rows[0]?.map((value) => value.trim().toLowerCase()) ?? [];
    const column = header.indexOf("code");
    if (column < 0) throw new DomainError("invalid", "В первой строке нужен заголовок столбца code.");
    const body = rows.slice(1);
    if (body.length > CODE_IMPORT_LIMITS.rows) throw new DomainError("invalid", `Не больше ${CODE_IMPORT_LIMITS.rows} кодов за раз.`);

    const unique = new Set<string>();
    let invalid = 0;
    let duplicatesInFile = 0;
    for (const row of body) {
      const code = normalizeCode(row[column] ?? "");
      if (!IMPORTED_CODE_PATTERN.test(code)) {
        invalid += 1;
      } else if (unique.has(code)) {
        duplicatesInFile += 1;
      } else {
        unique.add(code);
      }
    }
    const { added, duplicates } = await this.repository.importCodes(this.advent.slug, rewardId, [...unique]);
    await this.audit("reward_codes_imported", null, { rewardId, campaign: this.advent.slug, added });
    return { rows: body.length, added, duplicatesInFile, alreadyInPool: duplicates, invalid };
  }

  /** Сводка для админки: выдано и погашено, пулы кодов и остатки по наградам. */
  async overview(): Promise<RewardOverviewRow[]> {
    const [totals, pools, stock] = await Promise.all([
      this.repository.grantTotals(this.advent.slug),
      this.repository.poolOverview(this.advent.slug),
      this.repository.stockLeft(this.advent.slug)
    ]);
    const byReward = new Map(totals.map((row) => [row.rewardId, row]));
    return this.advent.rewards.map((reward) => {
      const isList = Boolean(reward.codes && "list" in reward.codes);
      return {
        rewardId: reward.id,
        label: reward.label,
        issued: byReward.get(reward.id)?.issued ?? 0,
        redeemed: byReward.get(reward.id)?.redeemed ?? 0,
        // Остаток ещё не заведён (розыгрыша не было) — берётся полный из пакета.
        stockLeft: reward.stock === undefined ? null : (stock[reward.id] ?? reward.stock),
        stockTotal: reward.stock ?? null,
        codesTotal: isList ? (pools[reward.id]?.total ?? 0) : null,
        codesFree: isList ? (pools[reward.id]?.free ?? 0) : null
      };
    });
  }

  /** Все выдачи кампании для CSV: без email и без кодов. */
  async exportGrants(): Promise<Array<RewardGrantRecord & { label: string }>> {
    const labels = this.rewardsById;
    return (await this.repository.listCampaignGrants(this.advent.slug)).map((grant) => ({ ...grant, label: labels.get(grant.rewardId)?.label ?? grant.rewardId }));
  }
}

export type RewardOverviewRow = {
  rewardId: string;
  label: string;
  issued: number;
  redeemed: number;
  stockLeft: number | null;
  stockTotal: number | null;
  codesTotal: number | null;
  codesFree: number | null;
};
