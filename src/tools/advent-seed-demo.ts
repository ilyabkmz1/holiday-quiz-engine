/**
 * Демо-данные адвента для показа клиенту (`npm run advent:seed-demo -- <slug>`): правдоподобные синтетические участники проходят
 * кампанию через настоящие сервисы, поэтому серии, награды, коды и остатки считаются теми же правилами, что в бою. Только для
 * пакетов с `demo: true` и вне production (проверяет скрипт). Реальных адресов нет: у подтверждённых участников email вида
 * `demo-<зерно>-<n>@seed.example.test` (зарезервированный домен; напоминания на него не уходят, см. `SYNTHETIC_EMAIL_DOMAIN`). Генератор детерминирован: то же зерно — те же решения.
 */
import type { AdventConfig } from "@/config/advent-schema";
import { dayIndexAt, dayLocalDate, dayUnlockAt, localInstant } from "@/domain/advent";
import { isDomainError } from "@/domain/errors";
import { correctPayload, partialPayload, wrongPayload } from "@/domain/solve";
import { createId, hashToken } from "@/server/crypto";
import { SYNTHETIC_EMAIL_DOMAIN, type AdventRepository, type ReminderRepository } from "@/server/repositories/advent-repository";
import type { AdventService } from "@/server/services/advent-service";

export type SeedOptions = {
  /** Сколько участников создать. */
  participants: number;
  /** Зерно генератора: то же зерно и параметры дают те же решения. */
  seed: number;
  /** Моделируем кампанию до этого момента (не позже финала). */
  through: Date;
};

export type SeedReport = {
  participants: number;
  verified: number;
  opens: number;
  caughtUp: number;
  reminders: number;
  redeemed: number;
  /** Спад активности к последнему дню, заложенный в этот прогон (доля от начальной вероятности открытия). */
  decay: number;
};

/** mulberry32: маленький детерминированный генератор. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Спад к концу кампании — случайно от 10 до 40% (зависит только от зерна). */
export function decayFor(seed: number): number {
  return 0.1 + seededRandom(seed ^ 0x9e3779b9)() * 0.3;
}

type Person = {
  id: string;
  arrival: Date;
  arrivalDay: number;
  /** Приверженность: от неё зависят вероятность открыть дверь, точность ответов и согласия. */
  loyalty: number;
  subscribed: boolean;
  missedInRow: number;
  gone: boolean;
};

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

export async function seedDemoAdvent(
  deps: { repository: AdventRepository & ReminderRepository; service: AdventService; advent: AdventConfig },
  options: SeedOptions
): Promise<SeedReport> {
  const { repository, service, advent } = deps;
  const { schedule } = advent;
  const rng = seededRandom(options.seed);
  const decay = decayFor(options.seed);
  const through = new Date(Math.min(options.through.getTime(), new Date(schedule.finaleAt).getTime() - 60_000));
  const lastDay = dayIndexAt(through, schedule);
  const report: SeedReport = { participants: 0, verified: 0, opens: 0, caughtUp: 0, reminders: 0, redeemed: 0, decay };
  if (lastDay === null) return report;

  // Приход участников: больше всего в первые дни, потом длинный хвост.
  const weights = Array.from({ length: lastDay }, (_, index) => Math.exp(-index / 5) + 0.18);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const pickDay = (): number => {
    let target = rng() * total;
    for (let index = 0; index < weights.length; index += 1) {
      target -= weights[index];
      if (target <= 0) return index + 1;
    }
    return lastDay;
  };
  const window = (day: number) => ({ from: dayUnlockAt(day, schedule).getTime(), to: Math.min(day < schedule.days ? dayUnlockAt(day + 1, schedule).getTime() : new Date(schedule.finaleAt).getTime(), through.getTime()) });
  const dayEnd = (day: number) => (day < schedule.days ? dayUnlockAt(day + 1, schedule).getTime() : new Date(schedule.finaleAt).getTime());
  const teams = advent.audience.leaderboard === "teams" ? (advent.audience.teams ?? []) : [];
  // Команды разного размера, последняя — совсем маленькая: на ней видно скрытие малых групп.
  const teamWeights = teams.map((_, index) => (index === teams.length - 1 && teams.length > 2 ? 0.008 : 1 - index * 0.15));

  const people: Person[] = [];
  for (let index = 0; index < options.participants; index += 1) {
    const arrivalDay = pickDay();
    const span = window(arrivalDay);
    const arrival = new Date(span.from + rng() * Math.max(1, span.to - span.from - 60_000));
    const loyalty = clamp(0.2 + rng() * 0.75);
    const verified = rng() < 0.18 + loyalty * 0.2;
    const marketing = verified && rng() < 0.65;
    let teamId: string | null = null;
    if (teams.length > 0 && rng() < 0.8) {
      let target = rng() * teamWeights.reduce((sum, weight) => sum + weight, 0);
      teamId = teams[teams.length - 1].id;
      for (let t = 0; t < teams.length; t += 1) {
        target -= teamWeights[t];
        if (target <= 0) {
          teamId = teams[t].id;
          break;
        }
      }
    }
    const id = createId();
    await repository.createParticipant({
      id,
      campaignSlug: advent.slug,
      accessKeyHash: hashToken(`demo-seed-${options.seed}-${index}-${id}`),
      normalizedEmail: verified ? `demo-${options.seed}-${index}@${SYNTHETIC_EMAIL_DOMAIN}` : null,
      teamId,
      consentAt: verified ? arrival : null,
      marketingConsentAt: marketing ? arrival : null,
      reminderOptIn: marketing && advent.reminders.channel === "email",
      unsubscribeHash: null,
      unsubscribedAt: null,
      createdAt: arrival
    });
    people.push({ id, arrival, arrivalDay, loyalty, subscribed: marketing && advent.reminders.channel === "email", missedInRow: 0, gone: false });
    report.participants += 1;
    if (verified) report.verified += 1;
  }

  const tasksOf = (n: number) => advent.days.find((day) => day.n === n)!.blocks;
  async function play(person: Person, day: number, at: Date): Promise<void> {
    try {
      await service.openDay(person.id, day, at);
    } catch (error) {
      if (isDomainError(error)) return;
      throw error;
    }
    report.opens += 1;
    if (at.getTime() >= dayEnd(day)) report.caughtUp += 1;
    const accuracy = 0.45 + person.loyalty * 0.5;
    const blocks = tasksOf(day);
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      // Часть игроков бросает день после истории: «прошли целиком» от «открыли» отличается.
      if (block.type !== "story" && rng() > 0.55 + person.loyalty * 0.4) break;
      const when = new Date(at.getTime() + (index + 1) * 40_000);
      try {
        if (block.type === "story") await service.submitBlock(person.id, day, index, {}, when);
        else if (block.type === "task") {
          const roll = rng();
          const payload = roll < accuracy ? correctPayload(block.task) : (roll < accuracy + 0.15 ? partialPayload(block.task) : null) ?? wrongPayload(block.task);
          await service.submitBlock(person.id, day, index, payload, when);
        } else if (block.type === "luck") await service.submitBlock(person.id, day, index, { choice: Math.floor(rng() * block.choices) }, when);
        else await service.submitBlock(person.id, day, index, {}, when);
      } catch (error) {
        if (!isDomainError(error)) throw error;
      }
    }
  }

  const catchUp = schedule.catchUp !== "none";
  for (let day = 1; day <= lastDay; day += 1) {
    const span = window(day);
    const decayFactor = 1 - decay * (schedule.days > 1 ? (day - 1) / (schedule.days - 1) : 0);
    const date = dayLocalDate(day, schedule);
    for (const person of people) {
      if (person.arrivalDay > day || person.gone) continue;
      let boost = 0;
      // Напоминание уходит, пока день не открыт; перешедших по нему становится больше.
      if (person.subscribed && advent.reminders.channel === "email") {
        const sendAt = new Date(Math.max(localInstant(date, advent.reminders.sendAtLocal, schedule.timezone).getTime(), person.arrival.getTime() + 60_000));
        if (sendAt.getTime() < span.to) {
          const claimed = await repository.claimReminder({
            deliveryId: createId(),
            participantId: person.id,
            day,
            now: sendAt,
            retryBefore: new Date(sendAt.getTime() - 3_600_000),
            maxAttempts: 3,
            unsubscribeHash: hashToken(`demo-unsub-${createId()}`)
          });
          if (claimed) {
            await repository.markReminderSent(claimed.id, sendAt);
            report.reminders += 1;
            if (rng() < 0.3 + person.loyalty * 0.2) {
              await repository.recordReminderClick(claimed.id, new Date(sendAt.getTime() + 600_000));
              boost = 0.35;
            }
          }
        }
      }
      const base = person.loyalty * decayFactor * (person.arrivalDay === day ? 1.1 : 1);
      const opens = rng() < clamp(base + boost);
      if (opens) {
        person.missedInRow = 0;
        // Время суток: утренний и вечерний пики.
        const peak = rng() < 0.5 ? 0.3 : 0.75;
        const fraction = clamp(peak + (rng() - 0.5) * 0.4);
        const at = new Date(Math.max(person.arrival.getTime() + 60_000, span.from + fraction * (span.to - span.from)));
        if (at.getTime() < span.to) await play(person, day, at);
      } else {
        person.missedInRow += 1;
        if (catchUp && day > 1 && rng() < 0.18 * person.loyalty) {
          await play(person, day - 1, new Date(Math.max(person.arrival.getTime() + 60_000, span.from + rng() * (span.to - span.from))));
        }
        if (person.missedInRow >= 3 && rng() < 0.5) person.gone = true;
      }
    }
  }

  // Погашения: часть выданных наград с кодом гасится на кассе в первые двое суток после выдачи.
  const redeemable = new Set(advent.rewards.filter((reward) => reward.redeem !== "none").map((reward) => reward.id));
  for (const grant of await repository.listCampaignGrants(advent.slug)) {
    if (grant.status !== "issued" || grant.code === null || !redeemable.has(grant.rewardId)) continue;
    if (rng() > 0.42) continue;
    const at = new Date(Math.min(through.getTime(), grant.createdAt.getTime() + rng() * 2 * 86_400_000));
    if (grant.expiresAt && at.getTime() >= grant.expiresAt.getTime()) continue;
    const outcome = await repository.redeemGrant(advent.slug, grant.id, at);
    if (outcome.status === "redeemed") report.redeemed += 1;
  }
  return report;
}
