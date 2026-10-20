import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { redeemAuthorized } from "@/server/admin";
import { getAdventServices, getNow } from "@/server/container";
import { redeemBody } from "@/server/redeem-api";
import { adventTenantForPage } from "@/server/page-tenant";

import type { RedeemView } from "./messages";
import { RedeemPanel } from "./RedeemPanel";

export const dynamic = "force-dynamic";

type RedeemPageProps = { searchParams: Promise<{ code?: string | string[] }> };

/**
 * Касса адвента: поле для кода (или переход по QR с `?code=`), сведения о награде и кнопка «Погасить».
 * Только для адвент-арендатора (на квизе — 404). Основной замок — proxy (Basic auth кассира или оператора);
 * проверка здесь — на случай, если страницу отдали в обход него. Сам код в журнал не пишется.
 */
export default async function RedeemPage({ searchParams }: RedeemPageProps) {
  const tenant = await adventTenantForPage();
  if (!(await redeemAuthorized(await headers()))) notFound();

  const raw = (await searchParams).code;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 300) ?? "";
  const timeZone = tenant.advent.schedule.timezone;
  let view: RedeemView | null = null;
  if (code) {
    const { rewardService } = getAdventServices(tenant);
    view = redeemBody(await rewardService.inspect(code, getNow())) as RedeemView;
  }

  return (
    <main className="redeem-page">
      <p className="redeem-eyebrow">{tenant.advent.brand.name} · касса</p>
      <h1>Погашение награды</h1>
      <form method="get" action="/redeem" className="redeem-form">
        <label htmlFor="redeem-code">Код награды или QR гостя</label>
        <input id="redeem-code" name="code" defaultValue={code} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus required maxLength={300} />
        <button type="submit" className="redeem-button">Проверить</button>
      </form>
      {view && (
        // key: новый код — новая панель с чистым состоянием.
        <RedeemPanel key={code} code={code} timeZone={timeZone} initial={view} />
      )}
      {!view && <p className="redeem-note">Введите код, который показал гость, или отсканируйте его QR камерой телефона.</p>}
    </main>
  );
}
