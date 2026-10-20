import type { Metadata } from "next";

import { AdventLogin } from "@/components/advent/AdventLogin";
import { DELIVERY_ID, loginTokenSchema } from "@/server/advent-api";
import { adventTenantForPage } from "@/server/page-tenant";

export const dynamic = "force-dynamic";

// В адресе одноразовый токен: страницу не индексируем и не отдаём адрес в Referer чужих сайтов (same-origin: при no-referrer форма шлёт Origin: null).
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "same-origin" };

type LoginPageProps = { searchParams: Promise<{ token?: string | string[]; r?: string | string[] }> };

/** Промежуточная страница входа адвента (на квиз-арендаторе — 404). Токен здесь не проверяется и не тратится. */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { advent } = await adventTenantForPage();
  const query = await searchParams;
  const parsed = loginTokenSchema.safeParse(query.token);
  // Идентификатор доставки письма-напоминания (uuid): без него вход обычный.
  const delivery = typeof query.r === "string" && DELIVERY_ID.test(query.r) ? query.r : null;
  return <AdventLogin advent={advent} token={parsed.success ? parsed.data : null} delivery={delivery} />;
}
