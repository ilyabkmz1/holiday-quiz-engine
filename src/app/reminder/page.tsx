import type { Metadata } from "next";

import { AdventReminderLogin, type ReminderLoginView } from "@/components/advent/AdventReminderLogin";
import { DELIVERY_ID } from "@/server/advent-api";
import { adventTenantForPage } from "@/server/page-tenant";

export const dynamic = "force-dynamic";

// В адресе идентификатор доставки: не индексируем и не отдаём его в Referer (same-origin: при no-referrer форма шлёт Origin: null).
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "same-origin" };

type ReminderPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

/**
 * Кнопка письма-напоминания на устройстве без входа владельца (на квиз-арендаторе — 404). GET ничего не меняет и
 * доставку не проверяет: её проверяет POST кнопки «Прислать ссылку для входа».
 */
export default async function ReminderPage({ searchParams }: ReminderPageProps) {
  const { advent } = await adventTenantForPage();
  const query = await searchParams;
  const delivery = one(query.r);
  const dayRaw = one(query.d);
  const day = dayRaw && /^\d{1,2}$/.test(dayRaw) && Number(dayRaw) >= 1 && Number(dayRaw) <= advent.schedule.days ? Number(dayRaw) : null;
  const view: ReminderLoginView = one(query.sent)
    ? { kind: "sent" }
    : delivery && DELIVERY_ID.test(delivery)
      ? { kind: "ask", delivery, day, notice: one(query.limited) ? "limited" : one(query.failed) ? "failed" : null }
      : { kind: "invalid" };
  return <AdventReminderLogin advent={advent} view={view} />;
}
