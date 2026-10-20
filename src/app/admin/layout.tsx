import type { Metadata } from "next";

import { anyTenantForPage } from "@/server/page-tenant";
import { tenantCore } from "@/server/tenants";

import "./admin.css";

export async function generateMetadata(): Promise<Metadata> {
  const campaign = tenantCore(await anyTenantForPage());
  return { title: `Панель оператора · ${campaign.brand.name} Quiz`, robots: { index: false, follow: false } };
}

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="admin">{children}</div>;
}
