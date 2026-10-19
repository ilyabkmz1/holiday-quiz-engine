import type { Metadata } from "next";

import { quizTenantForPage } from "@/server/page-tenant";

import "./admin.css";

export async function generateMetadata(): Promise<Metadata> {
  const { campaign } = (await quizTenantForPage());
  return { title: `Панель оператора · ${campaign.brand.name} Quiz`, robots: { index: false, follow: false } };
}

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="admin">{children}</div>;
}
