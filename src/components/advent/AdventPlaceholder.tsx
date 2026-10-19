import { BrandMark } from "@/components/game/BrandMark";
import type { AdventConfig } from "@/config/advent-schema";
import { adventPhase, dayUnlockAt } from "@/domain/advent";

/** «20 декабря» в часовом поясе кампании. */
export function startDateLabel(advent: Pick<AdventConfig, "schedule">): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: advent.schedule.timezone }).format(
    dayUnlockAt(1, advent.schedule)
  );
}

/**
 * Заглушка главной страницы адвент-арендатора (этап A1): бренд, название и дата старта.
 * Настоящий интерфейс (календарь дверей, лист дня, серия) появится на этапе A3.
 */
export function AdventPlaceholder({ advent, now }: { advent: AdventConfig; now: Date }) {
  const { brand } = advent;
  const upcoming = adventPhase(now, advent.schedule) === "upcoming";
  return (
    <main className="app verify-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark brand={{ name: brand.name, mark: brand.mark, wordmark: brand.wordmark, logo: brand.logo, tagline: brand.tagline, topNote: brand.topNote }} />
        </div>
        <div className="topbar-note">{brand.topNote}</div>
      </header>
      <section className="verify-card rise">
        <div className="eyebrow">{advent.subtitle}</div>
        <h1>{advent.title}</h1>
        <p>{upcoming ? `Адвент откроется ${startDateLabel(advent)}.` : "Адвент уже идёт, двери скоро появятся на этой странице."}</p>
        <p>{advent.intro}</p>
      </section>
    </main>
  );
}
