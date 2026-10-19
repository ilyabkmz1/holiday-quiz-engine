import { Inter, Manrope, Montserrat, Nunito, Onest, Rubik } from "next/font/google";

import type { FontId } from "@/config/brand";

// Каждый шрифт из allowlist (`FONT_IDS` в src/config/brand.ts) объявляется тут: next/font требует литеральных
// параметров прямо в вызове, поэтому ни цикл, ни общий объект настроек не годятся. В страницу применяется только выбранный пакетом; запасные шрифты вариативные и без preload,
// чтобы браузер скачивал файл только тогда, когда пакет выбрал этот шрифт.
const onest = Onest({ subsets: ["cyrillic", "latin"], weight: ["400", "500", "600", "700", "800"], display: "swap", variable: "--font-onest" });
const inter = Inter({ subsets: ["cyrillic", "latin"], display: "swap", variable: "--font-inter", preload: false });
const manrope = Manrope({ subsets: ["cyrillic", "latin"], display: "swap", variable: "--font-manrope", preload: false });
const montserrat = Montserrat({ subsets: ["cyrillic", "latin"], display: "swap", variable: "--font-montserrat", preload: false });
const nunito = Nunito({ subsets: ["cyrillic", "latin"], display: "swap", variable: "--font-nunito", preload: false });
const rubik = Rubik({ subsets: ["cyrillic", "latin"], display: "swap", variable: "--font-rubik", preload: false });

export const FONT_FACES: Record<FontId, { variable: string; stack: string }> = {
  onest: { variable: onest.variable, stack: 'var(--font-onest), "Onest", system-ui, -apple-system, "Segoe UI", sans-serif' },
  inter: { variable: inter.variable, stack: 'var(--font-inter), "Inter", system-ui, -apple-system, "Segoe UI", sans-serif' },
  manrope: { variable: manrope.variable, stack: 'var(--font-manrope), "Manrope", system-ui, -apple-system, "Segoe UI", sans-serif' },
  montserrat: { variable: montserrat.variable, stack: 'var(--font-montserrat), "Montserrat", system-ui, -apple-system, "Segoe UI", sans-serif' },
  nunito: { variable: nunito.variable, stack: 'var(--font-nunito), "Nunito", system-ui, -apple-system, "Segoe UI", sans-serif' },
  rubik: { variable: rubik.variable, stack: 'var(--font-rubik), "Rubik", system-ui, -apple-system, "Segoe UI", sans-serif' }
};
