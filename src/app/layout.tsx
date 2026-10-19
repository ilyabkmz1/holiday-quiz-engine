import type { Metadata, Viewport } from "next";

import { themeCss } from "@/config/theme";
import { anyTenantForPage } from "@/server/page-tenant";
import { tenantCore } from "@/server/tenants";

import { FONT_FACES } from "./fonts";
import "./globals.css";

// Бренд берётся из пакета арендатора, выбранного по Host: тема, шрифт и подписи вкладки.
export async function generateMetadata(): Promise<Metadata> {
  const campaign = tenantCore(await anyTenantForPage());
  return {
    title: `${campaign.title} · ${campaign.brand.name}`,
    description: campaign.brand.tagline
  };
}

export async function generateViewport(): Promise<Viewport> {
  const campaign = tenantCore(await anyTenantForPage());
  return { themeColor: campaign.brand.colors.bg, width: "device-width", initialScale: 1 };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const campaign = tenantCore(await anyTenantForPage());
  const font = FONT_FACES[campaign.brand.font];
  return (
    <html lang="ru" className={font.variable}>
      <head>
        <style id="brand-theme" dangerouslySetInnerHTML={{ __html: themeCss(campaign.brand.colors, campaign.brand.derived, font.stack, campaign.brand.pageArt) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
