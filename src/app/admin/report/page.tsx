import type { CSSProperties } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { dayLocalDate, reportPaperTheme } from "@/domain/advent";
import { adminAuthorized } from "@/server/admin";
import { adminUrl, resolveNow } from "@/server/advent-time";
import { loadTenantAnalytics } from "@/server/advent-report";
import { adventTenantForPage } from "@/server/page-tenant";

import { ColumnChart, DaysChart } from "../advent-charts";
import { CohortTable, FunnelList, KpiTiles, RewardGroups, TeamsTable, formatDecimal } from "../AdventSections";
import { formatCount, formatDateTime, formatDay, formatPercent } from "../format";
import { PrintButton } from "./PrintButton";
import "./report.css";

export const dynamic = "force-dynamic";

/**
 * Отчёт клиенту: итоги кампании в бренде клиента на одной странице, которую браузер печатает на A4 («Сохранить в PDF»).
 * Те же числа, что в `/admin` и CSV (`loadTenantAnalytics`); только оператор; кассиру и чужому арендатору — 401/404 как у `/admin`.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  if (!(await adminAuthorized(await headers()))) notFound();
  const tenant = await adventTenantForPage();
  const { advent } = tenant;
  const { asOf } = await searchParams;
  const data = await loadTenantAnalytics(tenant, resolveNow({ headers: await headers(), url: adminUrl(asOf) }, tenant));
  const theme = reportPaperTheme(advent.brand.colors.accent);
  const style = {
    "--r-paper": theme.paper,
    "--r-ink": theme.ink,
    "--r-muted": theme.muted,
    "--r-accent": theme.accent,
    "--r-line": theme.line
  } as CSSProperties;
  const first = dayLocalDate(1, advent.schedule);
  const last = dayLocalDate(advent.schedule.days, advent.schedule);
  const totalIssued = data.rewards.reduce((sum, reward) => sum + reward.issued, 0);
  const reminders = data.reminders;

  return (
    <main className="report" style={style}>
      <div className="report-toolbar no-print">
        <a className="admin-button ghost" href={asOf ? `/admin?asOf=${encodeURIComponent(asOf)}` : "/admin"}>← В панель</a>
        <PrintButton />
      </div>

      <header className="report-head">
        <div className="report-brand">
          {advent.brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- логотип арендатора: локальный файл из public/
            <img src={advent.brand.logo} alt={advent.brand.name} height={36} />
          ) : (
            <><span className="report-mark">{advent.brand.mark}</span><b>{advent.brand.wordmark}</b></>
          )}
        </div>
        <p className="report-eyebrow">Отчёт по кампании</p>
        <h1>{advent.title}</h1>
        <p className="report-sub">
          {formatDay(first)} — {formatDay(last)} · {advent.schedule.days} {advent.schedule.days === 1 ? "день" : "дней"} · данные на {formatDateTime(data.generatedAt, data.timezone)} ({data.timezone})
        </p>
      </header>

      <section aria-labelledby="r-kpi">
        <h2 id="r-kpi">Ключевые цифры</h2>
        <KpiTiles data={data} />
      </section>

      <section aria-labelledby="r-insights">
        <h2 id="r-insights">Выводы</h2>
        <ul className="insights">
          {data.insights.map((insight) => <li key={insight.key} data-tone={insight.tone}>{insight.text}</li>)}
        </ul>
      </section>

      <section aria-labelledby="r-days">
        <h2 id="r-days">Кривая по дням</h2>
        <DaysChart days={data.days} id="r-days-chart" open />
      </section>

      {data.bestDays.length > 0 && (
        <section aria-labelledby="r-best" className="report-pair">
          <div>
            <h2 id="r-best">Лучшие дни</h2>
            <DayRank days={data.bestDays} />
          </div>
          {data.weakDays.length > 0 && (
            <div>
              <h2>Слабые дни</h2>
              <DayRank days={data.weakDays} />
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="r-funnels">
        <h2 id="r-funnels">Воронки</h2>
        <div className="report-pair">
          <div>
            <h3>Регистрация</h3>
            <FunnelList steps={data.registration} base={data.kpis.participants} caption="Воронка регистрации" />
          </div>
          <div>
            <h3>Награды</h3>
            {totalIssued === 0 ? <p className="admin-empty">Наград пока не выдавали.</p> : <RewardGroups groups={data.rewardsByKind} caption="Тип награды" />}
          </div>
        </div>
        {reminders && reminders.channel === "email" && (
          <div>
            <h3>Напоминания</h3>
            <FunnelList
              caption="Воронка напоминаний"
              base={reminders.sent}
              steps={[
                { key: "sent", label: "Письма отправлены", count: reminders.sent, share: reminders.sent ? 1 : null },
                { key: "clicked", label: "Перешли по кнопке", count: reminders.clicked, share: reminders.sent ? reminders.clicked / reminders.sent : null },
                { key: "opened", label: "Открыли день после письма", count: reminders.openedAfter, share: reminders.sent ? reminders.openedAfter / reminders.sent : null }
              ]}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="r-doors" className="report-pair">
        <div>
          <h2 id="r-doors">Дверей на участника</h2>
          <p className="report-note">В среднем {formatDecimal(data.doors.avg)}, медиана {formatDecimal(data.doors.median)} (среди игроков).</p>
          <ColumnChart id="r-doors-chart" buckets={data.doors.buckets} caption="Сколько участников открыли столько дверей" xLabel="Открыто дверей" valueHeader="Дверей" />
        </div>
        <div>
          <h2>Лучшая серия</h2>
          <p className="report-note">В среднем {formatDecimal(data.streaks.avg)} дня подряд, медиана {formatDecimal(data.streaks.median)}.</p>
          <ColumnChart id="r-streak-chart" buckets={data.streaks.buckets} caption="Лучшая серия открытых вовремя дней" xLabel="Дней подряд" valueHeader="Серия" />
        </div>
      </section>

      <section aria-labelledby="r-cohorts">
        <h2 id="r-cohorts">Возврат участников</h2>
        <CohortTable data={data} />
        {data.goals.length > 0 && (
          <p className="report-note">
            Цели серии: {data.goals.map((goal) => `«${goal.label}» — ${formatCount(goal.reached)} (${formatPercent(goal.share)} игроков)`).join("; ")}.
          </p>
        )}
      </section>

      {data.teams && (
        <section aria-labelledby="r-teams">
          <h2 id="r-teams">Команды</h2>
          <TeamsTable data={data} />
        </section>
      )}

      <footer className="report-method">
        <h2>Как мы считаем</h2>
        <ul>
          <li><b>Участник</b> — устройство или аккаунт, зашедший в кампанию; <b>игрок</b> — открывший хотя бы одну дверь.</li>
          <li><b>Дни</b> делятся по времени кампании ({data.timezone}). «В свой день» — дверь открыта, пока её день не закончился; «догнали» — открыта позже по правилам догоняния.</li>
          <li><b>Активные</b> в день — те, кто открыл любую дверь до конца этого дня; <b>пропустили</b> — активные, не открывшие этот день вовсе. Текущий день считается предварительно.</li>
          <li><b>D1 / D3 / D7</b> — доля участников, открывших дверь через 1 / 3 / 7 суток после первого визита; в расчёт входят только когорты, у которых срок наступил и пришёлся на дни кампании (после финала двери не открываются). Когорты меньше {data.minGroup} человек не показываются.</li>
          <li><b>Серия</b> — дни подряд, открытые вовремя; пропуск прощают заморозки по правилам кампании.</li>
          <li><b>Погашение</b> считается только по наградам с кодом для кассы или сайта; баллы и участие в финале не погашаются.</li>
          <li>Отчёт содержит только агрегаты: ни email, ни имён, ни кодов участников. Выводы составлены автоматически по простым правилам и не заменяют анализ.</li>
        </ul>
      </footer>
    </main>
  );
}

function DayRank({ days }: { days: Array<{ day: number; title: string; onTime: number; active: number; onTimeShare: number | null }> }) {
  return (
    <table className="left">
      <thead><tr><th scope="col">День</th><th scope="col">Открыли в свой день</th><th scope="col">Доля активных</th></tr></thead>
      <tbody>
        {days.map((day) => (
          <tr key={day.day}>
            <th scope="row">{day.day}. {day.title}</th>
            <td>{formatCount(day.onTime)} из {formatCount(day.active)}</td>
            <td>{formatPercent(day.onTimeShare)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
