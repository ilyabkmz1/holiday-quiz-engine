import { loadAdventMetrics } from "@/server/advent-metrics";
import { loadTenantAnalytics } from "@/server/advent-report";
import { getAdventServices } from "@/server/container";
import type { AdventTenant } from "@/server/tenants";

import { ColumnChart, DaysChart } from "./advent-charts";
import { CohortTable, FunnelList, KpiTiles, RewardGroups, TeamsTable, formatDecimal } from "./AdventSections";
import { CodeImport } from "./CodeImport";
import { formatCount, formatDateTime, formatPercent } from "./format";

/**
 * Панель оператора адвент-арендатора: выдано и погашено по наградам, остатки удачи, свободные коды в пулах,
 * загрузка кодов и выгрузка выдач. Только числа: ни email, ни кодов участников здесь нет.
 */
export async function AdventAdmin({ tenant, now, asOf }: { tenant: AdventTenant; now: Date; asOf?: string }) {
  const q = asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
  const { advent } = tenant;
  const { rewardService, repository } = getAdventServices(tenant);
  const rows = await rewardService.overview();
  const [metrics, data] = await Promise.all([loadAdventMetrics(repository, advent, now), loadTenantAnalytics(tenant, now)]);
  const { reminders } = metrics;
  const listRewards = new Set(advent.rewards.filter((reward) => reward.codes && "list" in reward.codes).map((reward) => reward.id));

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <p className="admin-eyebrow">Панель оператора · адвент</p>
          <h1>{advent.title}</h1>
        </div>
        <p className="admin-note">Данные на {formatDateTime(data.generatedAt, advent.schedule.timezone)} ({advent.schedule.timezone}). Только агрегаты, без email и кодов участников.</p>
      </header>

      <div className="admin-actions">
        <a className="admin-button" href={`/admin/report${q}`}>Отчёт клиенту (PDF)</a>
        <a className="admin-button ghost" href={`/api/admin/advent/report/days.csv${q}`} download>CSV: по дням</a>
        <a className="admin-button ghost" href={`/api/admin/advent/report/rewards.csv${q}`} download>CSV: награды</a>
        <a className="admin-button ghost" href={`/api/admin/advent/report/cohorts.csv${q}`} download>CSV: когорты</a>
      </div>

      <section aria-labelledby="kpi-title" className="admin-card">
        <h2 id="kpi-title">Итоги</h2>
        <KpiTiles data={data} />
        <p className="admin-note">Участник — каждое устройство или вход по email; «игрок» — открывший хотя бы одну дверь. D1 и D7 считаются по тем, у кого этот день уже наступил.</p>
      </section>

      {data.insights.length > 0 && (
        <section aria-labelledby="insights-title" className="admin-card">
          <h2 id="insights-title">Выводы</h2>
          <ul className="insights">
            {data.insights.map((insight) => <li key={insight.key} data-tone={insight.tone}>{insight.text}</li>)}
          </ul>
          <p className="admin-note">Выводы составляются по простым правилам из чисел ниже, без нейросетей; при малых выборках (меньше {data.minGroup} человек) они молчат.</p>
        </section>
      )}

      <section aria-labelledby="days-title" className="admin-card">
        <h2 id="days-title">Кривая по дням</h2>
        <DaysChart days={data.days} />
        <p className="admin-note">«Активные» на конец дня — те, кто открыл любую дверь до его конца; пропустили — активные, не открывшие этот день ни вовремя, ни позже. Текущий день считается предварительно.</p>
      </section>

      <div className="admin-grid">
        <section aria-labelledby="doors-title" className="admin-card">
          <h2 id="doors-title">Дверей на участника</h2>
          <dl className="timing">
            <div><dt>Среднее (игроки)</dt><dd>{formatDecimal(data.doors.avg)}</dd></div>
            <div><dt>Медиана</dt><dd>{formatDecimal(data.doors.median)}</dd></div>
            <div><dt>Не открыли ни одной</dt><dd>{formatCount(data.doors.zero)}</dd></div>
          </dl>
          <ColumnChart id="doors-chart" buckets={data.doors.buckets} caption="Сколько участников открыли столько дверей" xLabel="Открыто дверей" valueHeader="Дверей" />
        </section>
        <section aria-labelledby="streak-title" className="admin-card">
          <h2 id="streak-title">Лучшая серия</h2>
          <dl className="timing">
            <div><dt>Среднее</dt><dd>{formatDecimal(data.streaks.avg)}</dd></div>
            <div><dt>Медиана</dt><dd>{formatDecimal(data.streaks.median)}</dd></div>
          </dl>
          <ColumnChart id="streak-chart" buckets={data.streaks.buckets} caption="Лучшая серия открытых вовремя дней" xLabel="Дней подряд" valueHeader="Серия" />
        </section>
      </div>

      <div className="admin-grid">
        <section aria-labelledby="reg-title" className="admin-card">
          <h2 id="reg-title">Воронка регистрации</h2>
          <FunnelList steps={data.registration} base={data.kpis.participants} caption="Воронка регистрации" />
          <p className="admin-note">После очистки персональных данных (`cleanup:pii`) числа по email и согласиям обнуляются.</p>
        </section>
        <section aria-labelledby="goals-title" className="admin-card">
          <h2 id="goals-title">Цели серии</h2>
          {data.goals.length === 0 ? (
            <p className="admin-empty">В пакете нет целей.</p>
          ) : (
            <ul className="funnel">
              {data.goals.map((goal) => (
                <li key={goal.opened}>
                  <span className="funnel-label">{goal.label}<small> · {goal.opened} дверей</small></span>
                  <span className="a-bar" aria-hidden="true"><span className="a-fill gold" style={{ width: `${(goal.share ?? 0) * 100}%` }} /></span>
                  <span className="funnel-count">{formatCount(goal.reached)}<small> · {formatPercent(goal.share)}</small></span>
                </li>
              ))}
            </ul>
          )}
          <p className="admin-note">Доля — от игроков; подаренный день за старт, если он включён, засчитывается в прогресс.</p>
        </section>
      </div>

      <section aria-labelledby="cohort-title" className="admin-card">
        <h2 id="cohort-title">Когорты: возврат по дню первого визита</h2>
        <CohortTable data={data} />
        <p className="admin-note">Когорта — участники, впервые пришедшие в этот день (по времени кампании). D1/D3/D7 — доля открывших дверь через 1/3/7 суток. Когорты меньше {data.minGroup} человек скрыты. Прочерк — срок ещё не наступил или выпал на дни, когда двери уже не открываются (после финала).</p>
      </section>

      <section aria-labelledby="reward-funnel-title" className="admin-card">
        <h2 id="reward-funnel-title">Воронка наград</h2>
        <div className="admin-grid">
          <RewardGroups groups={data.rewardsByKind} caption="По типам наград" />
          <RewardGroups groups={data.rewardsBySource} caption="По способу получения" />
        </div>
        <p className="admin-note">Доля погашения считается только по наградам, которые можно погасить (с кассой или ссылкой); баллы и участие в финале не гасятся. «Истекли» — выданы, не погашены, срок вышел.</p>
      </section>

      {data.teams && (
        <section aria-labelledby="teams-title" className="admin-card">
          <h2 id="teams-title">Команды</h2>
          <TeamsTable data={data} />
          <p className="admin-note">Рейтинг — по среднему числу дверей на участника; команды меньше {data.minGroup} человек скрыты. Тот же порог в публичном рейтинге, где цифры к тому же округлены, а размер команды дан интервалом.</p>
        </section>
      )}

      <section aria-labelledby="rewards-title" className="admin-card">
        <div className="claims-head">
          <h2 id="rewards-title">Награды</h2>
          <a className="admin-button" href="/api/admin/advent/grants.csv" download>Выгрузить выдачи CSV</a>
        </div>
        <div className="table-scroll">
          <table className="left">
            <thead>
              <tr>
                <th scope="col">Награда</th>
                <th scope="col">Выдано</th>
                <th scope="col">Погашено</th>
                <th scope="col">Остаток удачи</th>
                <th scope="col">Коды: свободно / всего</th>
                <th scope="col">Загрузка кодов</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rewardId}>
                  <th scope="row">{row.label}</th>
                  <td>{formatCount(row.issued)}</td>
                  <td>{formatCount(row.redeemed)}</td>
                  <td>{row.stockLeft === null ? "без лимита" : `${formatCount(row.stockLeft)} из ${formatCount(row.stockTotal ?? 0)}`}</td>
                  <td>{row.codesTotal === null ? "—" : `${formatCount(row.codesFree ?? 0)} / ${formatCount(row.codesTotal)}`}</td>
                  <td>{listRewards.has(row.rewardId) ? <CodeImport rewardId={row.rewardId} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="admin-note">
          CSV для загрузки — столбец <code>code</code> в первой строке; коды приводятся к верхнему регистру, повторы пропускаются.
          Остаток удачи заводится при первом розыгрыше. В выгрузке выдач нет email и кодов.
        </p>
      </section>

      <section aria-labelledby="reminders-title" className="admin-card">
        <h2 id="reminders-title">Напоминания</h2>
        {reminders.channel !== "email" ? (
          <p className="admin-empty">Напоминания в пакете выключены (<code>reminders.channel</code>).</p>
        ) : (
          <>
            <ul className="status-chips">
              <li>Подписаны: <strong>{formatCount(reminders.subscribed)}</strong></li>
              <li>Отписались: <strong>{formatCount(reminders.unsubscribed)}</strong></li>
            </ul>
            <div className="table-scroll">
              <table className="left">
                <thead>
                  <tr>
                    <th scope="col">День</th>
                    <th scope="col">Отправлено</th>
                    <th scope="col">Ошибки*</th>
                    <th scope="col">Переходы</th>
                    <th scope="col">Открыли день после письма</th>
                  </tr>
                </thead>
                <tbody>
                  {reminders.days.map((row) => (
                    <tr key={row.day}>
                      <th scope="row">{row.day}. {row.title}</th>
                      <td>{formatCount(row.sent)}</td>
                      <td>{formatCount(row.failed)}</td>
                      <td>{formatCount(row.clicked)}</td>
                      <td>{formatCount(row.openedAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="admin-note">
              Только числа, без email. * «Ошибки» — письма, которые не ушли (повтор в следующий запуск, пока есть попытки), и застрявшие
              в статусе <code>sending</code>: заявлены, но отправка не подтверждена (процесс упал во время отправки; такие письма не повторяются).
              «Подписаны» — с согласием на рассылку и включёнными напоминаниями. «Переходы» — клики с устройств, где участник уже вошёл,
              и нажатия «Прислать ссылку для входа» на остальных.
              Те же данные — в <code>GET /api/admin/advent/metrics</code>.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
