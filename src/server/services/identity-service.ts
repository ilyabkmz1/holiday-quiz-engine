import type { AdventConfig } from "@/config/advent-schema";
import { adventPhase } from "@/domain/advent";
import { DomainError } from "@/domain/errors";
import { createOpaqueToken, hashToken } from "@/server/crypto";
import { normalizeEmail } from "@/server/email";
import type { AdventRepository, IdentityRepository, ParticipantRecord } from "@/server/repositories/advent-repository";
import { assertParticipantId } from "@/server/services/advent-service";

/** Ссылка входа живёт 30 минут и срабатывает один раз. */
export const LOGIN_TOKEN_TTL_MS = 30 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type IdentityServiceDependencies = {
  repository: AdventRepository & IdentityRepository;
  advent: AdventConfig;
  /** Отправляет письмо со ссылкой входа. Адрес и ссылка в логи не пишутся. */
  sendLoginLink: (email: string, link: string) => Promise<void>;
  /** Запись об ошибке доставки (без адреса и ссылки). */
  recordDeliveryFailure?: (participantId: string) => Promise<void>;
  /** Адрес маршрута подтверждения без query: к нему добавляется `?token=…`. */
  verifyEndpoint: string;
  /**
   * После подтверждения ссылки (A2): дозаполнить код и срок у наград, выданных участнику до входа
   * (`AdventService.ensureCodes`). Сбой не отменяет вход: коды дозаполнятся при следующем обращении.
   */
  onVerified?: (participantId: string, now: Date) => Promise<void>;
};

export type RequestLinkInput = {
  email: string;
  /** Согласие на обработку персональных данных (152-ФЗ): без него ссылка не отправляется. */
  consent: boolean;
  /** Отдельное согласие на рекламную и информационную рассылку (ст. 18 38-ФЗ). */
  marketingConsent: boolean;
  /** Напоминания об открытии дверей — рассылка: только вместе с `marketingConsent`. */
  reminderOptIn: boolean;
};

export class IdentityService {
  constructor(private readonly dependencies: IdentityServiceDependencies) {}

  /**
   * «Сохранить серию»: запрос ссылки входа. Email и согласия записываются в ссылку и применяются к участнику
   * только после подтверждения: чужой адрес нельзя занять без доступа к почте. Ответ не зависит от того,
   * знаем ли мы этот email (нет перебора адресов).
   */
  async requestLink(participantId: string, input: RequestLinkInput, now: Date): Promise<void> {
    const { repository, advent } = this.dependencies;
    if (adventPhase(now, advent.schedule) === "closed") throw new DomainError("conflict", "Адвент завершён.");
    if (!input.consent) throw new DomainError("conflict", "Нужно согласие на обработку данных.");
    if (input.reminderOptIn && !input.marketingConsent) throw new DomainError("invalid", "Напоминания включаются только с согласием на рассылку.");
    const email = normalizeEmail(input.email);
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new DomainError("invalid", "Проверьте email.");

    assertParticipantId(participantId);
    const participant = await repository.getParticipant(participantId);
    if (!participant || participant.campaignSlug !== advent.slug) throw new DomainError("not_found", "Участник не найден.");

    const token = createOpaqueToken();
    await repository.createLoginToken({
      tokenHash: hashToken(token),
      participantId,
      normalizedEmail: email,
      consentAt: now,
      marketingConsentAt: input.marketingConsent ? now : null,
      // Напоминания возможны, только если кампания их включила.
      reminderOptIn: input.reminderOptIn && advent.reminders.channel === "email",
      createdAt: now,
      expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MS),
      usedAt: null
    });

    await this.send(participantId, email, token, null);
  }

  /**
   * «Прислать ссылку для входа» со страницы письма-напоминания (вход из письма только по cookie, иначе — эта кнопка).
   * Обычная свежая ссылка входа (30 минут, одноразовая, семантика `requestLink`): запросило устройство `requesterId`, а адрес —
   * подтверждённый адрес владельца письма из БД; сама страница email не видит и не принимает. Согласия ссылка не меняет:
   * они уже даны владельцем, отметка напоминаний не ставится. В ссылку добавлен идентификатор доставки `r`: после входа
   * открывается день письма.
   */
  async requestOwnerLink(requesterId: string, owner: ParticipantRecord, deliveryId: string, now: Date): Promise<void> {
    const { repository, advent } = this.dependencies;
    if (adventPhase(now, advent.schedule) === "closed") throw new DomainError("conflict", "Адвент завершён.");
    if (owner.campaignSlug !== advent.slug || owner.normalizedEmail === null || owner.consentAt === null) {
      throw new DomainError("not_found", "Участник не найден.");
    }
    assertParticipantId(requesterId);
    const requester = await repository.getParticipant(requesterId);
    if (!requester || requester.campaignSlug !== advent.slug) throw new DomainError("not_found", "Участник не найден.");

    const token = createOpaqueToken();
    await repository.createLoginToken({
      tokenHash: hashToken(token),
      participantId: requesterId,
      normalizedEmail: owner.normalizedEmail,
      consentAt: owner.consentAt,
      marketingConsentAt: null,
      reminderOptIn: false,
      createdAt: now,
      expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MS),
      usedAt: null
    });
    await this.send(requesterId, owner.normalizedEmail, token, deliveryId);
  }

  private async send(participantId: string, email: string, token: string, deliveryId: string | null): Promise<void> {
    const url = new URL(this.dependencies.verifyEndpoint);
    url.searchParams.set("token", token);
    if (deliveryId) url.searchParams.set("r", deliveryId);
    try {
      await this.dependencies.sendLoginLink(email, url.toString());
    } catch (error) {
      await this.dependencies.recordDeliveryFailure?.(participantId);
      throw error;
    }
  }

  /**
   * Подтверждение ссылки. Привязывает устройство к участнику с этим email; если на устройстве или у запросившего
   * был свой анонимный прогресс, он вливается (см. `IdentityRepository.completeLogin`). Возвращает новый ключ cookie.
   */
  async verify(token: string, currentParticipant: ParticipantRecord | null, now: Date): Promise<{ participant: ParticipantRecord; accessKey: string }> {
    const accessKey = createOpaqueToken();
    const { participant } = await this.dependencies.repository.completeLogin({
      tokenHash: hashToken(token),
      now,
      campaignSlug: this.dependencies.advent.slug,
      currentParticipantId: currentParticipant?.id ?? null,
      newAccessKeyHash: hashToken(accessKey)
    });
    try {
      await this.dependencies.onVerified?.(participant.id, now);
    } catch {
      // Только событие без персональных данных: вход уже состоялся, коды дозаполнятся при следующем обращении.
      console.error(JSON.stringify({ event: "advent_ensure_codes_failed", participantId: participant.id }));
    }
    return { participant, accessKey };
  }
}
