import type { MailVars } from "@/server/mailer";
import { ReminderService, type ReminderOptions, type ReminderRunResult } from "@/server/services/reminder-service";
import type { AdventRepository, IdentityRepository, ReminderRepository } from "@/server/repositories/advent-repository";
import { tenantBaseUrl, type AdventTenant } from "@/server/tenants";

export type { ReminderRunResult };

export type TenantRunReport = { tenant: string } & (ReminderRunResult | { skipped: "demo"; day: null; claimed: 0; sent: 0; failed: 0; lostClaims: 0 });

type RunEnv = Record<string, string | undefined>;

type AdventRepositories = AdventRepository & IdentityRepository & ReminderRepository;

/** Время запуска: `ADVENT_REMIND_AS_OF` разрешён вне production и для демо-пакетов, иначе игнорируется (как `?asOf=` в API). */
function runTime(asOf: string | undefined, tenant: AdventTenant, nodeEnv: string | undefined, now: () => Date): Date {
  if (!asOf) return now();
  if (nodeEnv === "production" && !tenant.demo) {
    console.warn(JSON.stringify({ event: "advent_remind_as_of_ignored", tenant: tenant.tenant }));
    return now();
  }
  const parsed = new Date(asOf);
  if (Number.isNaN(parsed.getTime()) || !/(Z|[+-]\d{2}:\d{2})$/.test(asOf)) throw new Error("ADVENT_REMIND_AS_OF: ожидается дата ISO 8601 со смещением");
  return parsed;
}

/**
 * Запуск рассылки по адвент-арендаторам (`npm run advent:remind`, cron раз в 15 минут). Демо-пакеты (`demo: true`) писем
 * не шлют, пока не задан `ADVENT_REMINDERS_DEMO=true`. Время — часы сервера; `ADVENT_REMIND_AS_OF` (ISO 8601 со смещением)
 * сдвигает его только вне production или для демо-пакета (как `?asOf=` в API) и нужен E2E.
 */
export async function runAdventReminders(input: {
  tenants: readonly AdventTenant[];
  env: RunEnv;
  now: () => Date;
  appUrl: string;
  options: ReminderOptions;
  repositoryFor: (tenant: AdventTenant) => AdventRepositories;
  send: (email: string, vars: MailVars["reminder"]) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<TenantRunReport[]> {
  const reports: TenantRunReport[] = [];
  for (const tenant of input.tenants) {
    if (tenant.advent.reminders.channel !== "email") continue;
    if (tenant.demo && input.env.ADVENT_REMINDERS_DEMO !== "true") {
      reports.push({ tenant: tenant.tenant, skipped: "demo", day: null, claimed: 0, sent: 0, failed: 0, lostClaims: 0 });
      continue;
    }
    const now = runTime(input.env.ADVENT_REMIND_AS_OF, tenant, input.env.NODE_ENV, input.now);
    const service = new ReminderService({
      repository: input.repositoryFor(tenant),
      advent: tenant.advent,
      baseUrl: tenantBaseUrl(tenant, input.appUrl),
      send: input.send,
      options: input.options,
      sleep: input.sleep
    });
    reports.push({ tenant: tenant.tenant, ...(await service.run(now)) });
  }
  return reports;
}
