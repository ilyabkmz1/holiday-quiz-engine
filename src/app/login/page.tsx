import type { Metadata } from "next";

import { AdventLogin } from "@/components/advent/AdventLogin";
import { loginTokenSchema } from "@/server/advent-api";
import { adventTenantForPage } from "@/server/page-tenant";

export const dynamic = "force-dynamic";

// В адресе одноразовый токен: страницу не индексируем.
export const metadata: Metadata = { robots: { index: false, follow: false } };

type LoginPageProps = { searchParams: Promise<{ token?: string | string[] }> };

/** Промежуточная страница входа адвента (на квиз-арендаторе — 404). Токен здесь не проверяется и не тратится. */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { advent } = await adventTenantForPage();
  const parsed = loginTokenSchema.safeParse((await searchParams).token);
  return <AdventLogin advent={advent} token={parsed.success ? parsed.data : null} />;
}
