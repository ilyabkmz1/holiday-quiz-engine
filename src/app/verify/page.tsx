import Link from "next/link";

import { BrandMark } from "@/components/game/BrandMark";
import { publicCampaign } from "@/server/presentation";
import { quizTenantForPage } from "@/server/page-tenant";

type VerifyPageProps = { searchParams: Promise<{ status?: string; reason?: string }> };

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const params = await searchParams;
  const { brand } = publicCampaign((await quizTenantForPage()).campaign);
  const success = params.status === "success";
  return (
    <main className="app verify-page">
      <header className="topbar">
        <div className="brand"><BrandMark brand={brand} /></div>
        <div className="topbar-note">{brand.topNote}</div>
      </header>
      <section className="verify-card rise">
        <span className={`verify-icon${success ? " success" : ""}`} aria-hidden="true">{success ? "✓" : "!"}</span>
        <div className="eyebrow">Подтверждение заявки</div>
        <h1>{success ? "Результат подтверждён" : "Ссылка не сработала"}</h1>
        <p>
          {success
            ? "Заявка стала призовой. Организатор свяжется с вами после завершения кампании."
            : "Возможно, ссылка устарела или период подтверждения уже завершён."}
        </p>
        <Link className="btn btn-primary" href="/">Вернуться к квизу</Link>
      </section>
    </main>
  );
}
