import type { Metadata } from "next";

import { AdventUnsubscribe, type UnsubscribeView } from "@/components/advent/AdventUnsubscribe";
import { unsubscribeTokenSchema } from "@/server/advent-api";
import { adventTenantForPage } from "@/server/page-tenant";

export const dynamic = "force-dynamic";

// В адресе токен отписки: не индексируем и не отдаём его в Referer чужих сайтов. Именно same-origin, а не no-referrer: при no-referrer браузер шлёт форме Origin: null и проверка Origin отвергает кнопку.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "same-origin" };

type UnsubscribePageProps = { searchParams: Promise<{ t?: string | string[]; done?: string | string[]; error?: string | string[] }> };

/** Страница отписки от напоминаний адвента (на квиз-арендаторе — 404). GET токен не проверяет и ничего не меняет. */
export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const { advent } = await adventTenantForPage();
  const query = await searchParams;
  const token = unsubscribeTokenSchema.safeParse(query.t);
  const view: UnsubscribeView = query.done ? "done" : query.error ? "error" : "confirm";
  return <AdventUnsubscribe advent={advent} view={view} token={token.success ? token.data : null} />;
}
