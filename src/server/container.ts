import { getPrisma } from "@/server/db";
import { getRuntimeEnv, isForceOpenAllowed } from "@/server/env";
import { resolveRewardSecret } from "@/server/launch-checks";
import { sendMail, sendVerificationEmail, type MailVars } from "@/server/mailer";
import { PrismaAdventRepository } from "@/server/repositories/prisma-advent-repository";
import { PrismaClaimRepository } from "@/server/repositories/prisma-claim-repository";
import { PrismaSessionRepository } from "@/server/repositories/prisma-session-repository";
import { ClaimService } from "@/server/services/claim-service";
import { AdventService } from "@/server/services/advent-service";
import { IdentityService, LOGIN_TOKEN_TTL_MS } from "@/server/services/identity-service";
import { ReminderService, type ReminderOptions } from "@/server/services/reminder-service";
import { RewardService, type RewardServiceOptions } from "@/server/services/reward-service";
import { RushService } from "@/server/services/rush-service";
import { SessionService } from "@/server/services/session-service";
import { isAdventTenant, resolveTenant, tenantBaseUrl, type AdventTenant, type Tenant } from "@/server/tenants";
import { verificationEndpoint } from "@/server/urls";

type ServiceOverrides = {
  sendVerification?: (email: string, link: string) => Promise<void>;
  /** Отправка ссылки входа адвента (email, ссылка). */
  sendLogin?: (email: string, link: string) => Promise<void>;
  /** Отправка письма-напоминания адвента (email, готовые переменные шаблона). */
  sendReminder?: (email: string, vars: MailVars["reminder"]) => Promise<void>;
  now?: () => Date;
  /** Пауза рассылки напоминаний (в тестах не ждёт). */
  sleep?: (ms: number) => Promise<void>;
  /** Параметры наград адвента (источник случайности кодов, секрет QR): в тестах подменяются. */
  rewards?: Pick<RewardServiceOptions, "rng" | "qrSecret">;
  /** Источник случайности для порядка заявок рывка; в тестах подменяется детерминированным. */
  random?: () => number;
};

let overrides: ServiceOverrides = {};

/** Test seam: подмена отправки писем и часов. В production не вызывается. */
export function overrideServices(next: ServiceOverrides): void {
  overrides = next;
}

export function resetServiceOverrides(): void {
  overrides = {};
}

export function getNow(): Date {
  return (overrides.now ?? (() => new Date()))();
}

// Тестовый хук для E2E и локальной разработки. Окна кампании расширяются только там,
// где isForceOpenAllowed() разрешает QUIZ_FORCE_OPEN: вне production или в локальном
// контуре (QUIZ_LOCAL_STACK и loopback APP_URL).
// Без этого заявки и подтверждения зависят от реальной даты и недоступны вне 20.12–02.01.
const FORCE_OPEN_WINDOW = {
  startsAt: "2000-01-01T00:00:00Z",
  claimEndsAt: "2999-12-31T23:59:59Z",
  verificationEndsAt: "2999-12-31T23:59:59Z"
} as const;

/** Арендатор по умолчанию: `TENANT` или первый пакет. Нужен скриптам и тестам, у которых нет запроса. */
export function defaultTenant(): Tenant {
  const tenant = resolveTenant(null);
  if (isAdventTenant(tenant)) throw new Error(`Арендатор «${tenant.tenant}» — адвент: используйте getAdventServices`);
  return tenant;
}

/** Сервисы одного арендатора: у каждого своя кампания, а БД и репозитории общие (данные разделены по `campaignSlug`). */
export function getServices(tenant: Tenant = defaultTenant()) {
  // Типы не пускают адвент-арендатора сюда, но вызов из JS или через `as` должен падать понятно, а не на `.campaign`.
  if ((tenant as { experience?: string }).experience === "advent") {
    throw new Error(`getServices вызван для адвента «${tenant.tenant}»: используйте getAdventServices`);
  }
  const campaign = tenant.campaign;
  const prisma = getPrisma();
  const sessions = new PrismaSessionRepository(prisma);
  const claims = new PrismaClaimRepository(prisma);
  const env = getRuntimeEnv();
  const sessionService = new SessionService(sessions, campaign, overrides.now);
  const claimCampaign = isForceOpenAllowed(env) ? { ...campaign, ...FORCE_OPEN_WINDOW } : campaign;
  return {
    prisma,
    sessions,
    claims,
    sessionService,
    rushService: new RushService(sessions, sessionService, campaign, overrides.now, overrides.random),
    claimService: new ClaimService({
      sessions,
      claims,
      campaign: claimCampaign,
      now: overrides.now,
      sendVerification: overrides.sendVerification ?? ((email, link) => sendVerificationEmail(email, link, campaign.brand.mailSubject)),
      recordDeliveryFailure: async (claimId) => {
        await prisma.auditEvent.create({
          data: { eventType: "verification_email_failed", entityId: claimId }
        });
      },
      verificationBaseUrl: verificationEndpoint(tenantBaseUrl(tenant, env.APP_URL))
    })
  };
}

/** Сервисы адвент-арендатора: участники, прогресс и вход по ссылке. Данные разделены по `campaignSlug`, как у квиза. */
export function getAdventServices(tenant: AdventTenant, settings: { reminderOptions?: ReminderOptions } = {}) {
  // Типы не пускают квиз-арендатора сюда, но вызов из JS или через `as` должен падать понятно.
  if ((tenant as { experience?: string }).experience !== "advent") {
    throw new Error(`getAdventServices вызван для квиза «${(tenant as { tenant: string }).tenant}»: используйте getServices`);
  }
  const { advent } = tenant;
  const prisma = getPrisma();
  const repository = new PrismaAdventRepository(prisma);
  const env = getRuntimeEnv();
  const rewardService = new RewardService(repository, advent, {
    qrSecret: resolveRewardSecret(env),
    baseUrl: tenantBaseUrl(tenant, env.APP_URL),
    audit: async (eventType, entityId, metadata) => {
      await prisma.auditEvent.create({ data: { eventType, entityId, ...(metadata ? { metadata } : {}) } });
    },
    ...overrides.rewards
  });
  const adventService = new AdventService(repository, advent, rewardService);
  return {
    prisma,
    repository,
    adventService,
    rewardService,
    /** Строка кампании нужна внешним ключам кодов и остатков: оператор может загрузить коды до первого участника. */
    ensureCampaign: async () => {
      await prisma.campaign.upsert({ where: { slug: advent.slug }, update: {}, create: { slug: advent.slug, title: advent.title } });
    },
    reminderService: new ReminderService({
      repository,
      advent,
      baseUrl: tenantBaseUrl(tenant, env.APP_URL),
      send: overrides.sendReminder ?? ((email, vars) => sendMail("reminder", email, vars)),
      options: settings.reminderOptions,
      sleep: overrides.sleep
    }),
    identityService: new IdentityService({
      repository,
      advent,
      onVerified: (participantId, now) => adventService.ensureCodes(participantId, now),
      sendLoginLink:
        overrides.sendLogin ??
        ((email, link) =>
          sendMail("login", email, {
            link,
            subject: `${advent.brand.name}: вход по ссылке`,
            brandName: advent.brand.name,
            ttlMinutes: LOGIN_TOKEN_TTL_MS / 60_000
          })),
      recordDeliveryFailure: async (participantId) => {
        await prisma.auditEvent.create({ data: { eventType: "login_email_failed", entityId: participantId } });
      },
      verifyEndpoint: new URL("/api/advent/identity/verify", tenantBaseUrl(tenant, env.APP_URL)).toString()
    })
  };
}
