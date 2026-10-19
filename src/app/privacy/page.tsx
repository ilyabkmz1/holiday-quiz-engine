import type { Metadata } from "next";
import Link from "next/link";

import { quizTenantForPage } from "@/server/page-tenant";

import "./privacy.css";

export async function generateMetadata(): Promise<Metadata> {
  const { campaign } = (await quizTenantForPage());
  return {
    title: `Политика обработки данных · ${campaign.title}`,
    description: `Как ${campaign.legal.operatorName} обрабатывает персональные данные участников квиза.`
  };
}

/** Абзацы политики разделены пустой строкой. */
function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}

export default async function PrivacyPage() {
  const { campaign } = (await quizTenantForPage());
  const { operatorName, policyText } = campaign.legal;
  return (
    <main className="privacy-page">
      <article className="privacy-card">
        <p className="privacy-eyebrow">{campaign.title}</p>
        <h1>Политика обработки персональных данных</h1>
        <p className="privacy-operator">Оператор: {operatorName}</p>
        {paragraphs(policyText).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
        <Link className="privacy-back" href="/">Вернуться к квизу</Link>
      </article>
    </main>
  );
}
