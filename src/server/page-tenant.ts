import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { anyTenantFromHeaders, isAdventTenant, type AdventTenant, type AnyTenant, type Tenant } from "@/server/tenants";

/** Арендатор любого вида для страницы. */
export async function anyTenantForPage(): Promise<AnyTenant> {
  return anyTenantFromHeaders(await headers());
}

/** Арендатор-квиз для квизовой страницы; на адвент-арендаторе страницы не существует (404). */
export async function quizTenantForPage(): Promise<Tenant> {
  const tenant = await anyTenantForPage();
  if (isAdventTenant(tenant)) notFound();
  return tenant;
}

/** Арендатор-адвент для адвентовой страницы; на квизе — 404. */
export async function adventTenantForPage(): Promise<AdventTenant> {
  const tenant = await anyTenantForPage();
  if (!isAdventTenant(tenant)) notFound();
  return tenant;
}
