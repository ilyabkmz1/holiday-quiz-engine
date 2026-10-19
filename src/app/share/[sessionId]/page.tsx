import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getPrisma } from "@/server/db";
import { getRuntimeEnv } from "@/server/env";
import { loadShareSummaryCached } from "@/server/share";
import { quizTenantForPage } from "@/server/page-tenant";
import { shareImageUrl, shareUrl } from "@/server/urls";

import "./share.css";

export const dynamic = "force-dynamic";

type SharePageProps = { params: Promise<{ sessionId: string }> };

const formatScore = (score: number) => new Intl.NumberFormat("ru-RU").format(score);

// Канонический id в нижнем регистре: ссылки в разном регистре дают один и тот же canonical и og:url.
const resolveSessionId = async (params: SharePageProps["params"]) => (await params).sessionId.toLowerCase();

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const sessionId = await resolveSessionId(params);
  const { campaign } = (await quizTenantForPage());
  const summary = await loadShareSummaryCached(getPrisma(), campaign, sessionId);
  if (!summary) return { title: "Результат не найден", robots: { index: false, follow: false } };

  const appUrl = getRuntimeEnv().APP_URL;
  const title = `${formatScore(summary.score)} очков · ${summary.tierTitle}`;
  const description = `Я прошёл «${summary.campaignTitle}» и получил уровень «${summary.tierTitle}». Сыграйте и вы!`;
  const image = { url: shareImageUrl(sessionId, appUrl), width: 1200, height: 630, alt: title };
  return {
    metadataBase: new URL(appUrl),
    title,
    description,
    alternates: { canonical: shareUrl(sessionId, appUrl) },
    openGraph: { type: "website", siteName: campaign.brand.name, locale: "ru_RU", url: shareUrl(sessionId, appUrl), title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] }
  };
}

export default async function SharePage({ params }: SharePageProps) {
  const sessionId = await resolveSessionId(params);
  const { campaign } = (await quizTenantForPage());
  const summary = await loadShareSummaryCached(getPrisma(), campaign, sessionId);
  if (!summary) notFound();

  return (
    <main className="share-page">
      <section className="share-card" aria-labelledby="share-title">
        <p className="share-eyebrow">{summary.campaignTitle}</p>
        <h1 id="share-title">
          <span className="share-score">{formatScore(summary.score)}</span>
          <span className="share-unit"> очков</span>
        </h1>
        <p className="share-tier">{summary.tierTitle}</p>
        <p className="share-lead">{campaign.story.shareLead}</p>
        <Link className="share-button" href="/">Сыграть самому</Link>
      </section>
    </main>
  );
}
