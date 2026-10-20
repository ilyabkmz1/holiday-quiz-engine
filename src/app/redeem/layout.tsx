import type { Metadata } from "next";

import { adventTenantForPage } from "@/server/page-tenant";

import "./redeem.css";

export async function generateMetadata(): Promise<Metadata> {
  const { advent } = await adventTenantForPage();
  return { title: `Касса · ${advent.brand.name}`, robots: { index: false, follow: false } };
}

export default function RedeemLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="redeem">{children}</div>;
}
