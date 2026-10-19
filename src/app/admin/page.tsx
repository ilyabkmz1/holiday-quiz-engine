import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { adminAuthorized } from "@/server/admin";
import { getPrisma } from "@/server/db";
import { loadAdminClaims, loadDashboardMetrics } from "@/server/metrics";
import { quizTenantForPage } from "@/server/page-tenant";

import { ExportButton } from "./ExportButton";
import {
  CLAIM_STATUS_LABELS,
  formatCount,
  formatDateTime,
  formatDay,
  formatDuration,
  formatPercent
} from "./format";

export const dynamic = "force-dynamic";

const widthOf = (value: number, max: number) => `${max ? Math.max(value ? 2 : 0, (value / max) * 100) : 0}%`;

export default async function AdminPage() {
  // Основной замок — proxy (src/proxy.ts); проверка здесь на случай, если страницу отдали в обход него.
  if (!(await adminAuthorized(await headers()))) notFound();

  const { campaign } = (await quizTenantForPage());
  const prisma = getPrisma();
  const [metrics, claims] = await Promise.all([loadDashboardMetrics(prisma, campaign), loadAdminClaims(prisma, campaign)]);
  const started = metrics.funnel[0]?.count ?? 0;
  const maxDaily = Math.max(1, ...metrics.daily.map((row) => row.started));

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <p className="admin-eyebrow">Панель оператора</p>
          <h1>{campaign.title}</h1>
        </div>
        <p className="admin-note">Данные на {formatDateTime(metrics.generatedAt)} (МСК). Только агрегаты, без email.</p>
      </header>

      <section aria-labelledby="funnel-title" className="admin-card">
        <h2 id="funnel-title">Воронка</h2>
        <ol className="funnel">
          {metrics.funnel.map((step) => (
            <li key={step.key}>
              <span className="funnel-label">{step.label}</span>
              <span className="a-bar"><span className="a-fill" style={{ width: widthOf(step.count, started) }} /></span>
              <span className="funnel-count">{formatCount(step.count)}<small>{started ? ` · ${formatPercent(step.count / started)}` : ""}</small></span>
            </li>
          ))}
        </ol>
        <p className="admin-note">Доля — от числа начатых сессий. «Вход в комнату» и «комната завершена» считают игроков в этой комнате.</p>
      </section>

      <section aria-labelledby="daily-title" className="admin-card">
        <h2 id="daily-title">По дням</h2>
        {metrics.daily.length === 0 ? (
          <p className="admin-empty">Пока нет данных.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">День</th>
                  <th scope="col">Старты</th>
                  <th scope="col">Входы в комнаты</th>
                  <th scope="col">Комнаты завершены</th>
                  <th scope="col">Рывок начат</th>
                  <th scope="col">Рывок завершён</th>
                  <th scope="col">Игра завершена</th>
                  <th scope="col">Заявки</th>
                  <th scope="col">Подтверждено</th>
                  <th scope="col">Выгружено</th>
                </tr>
              </thead>
              <tbody>
                {metrics.daily.map((row) => (
                  <tr key={row.date}>
                    <th scope="row">
                      {formatDay(row.date)}
                      <span className="a-bar thin"><span className="a-fill" style={{ width: widthOf(row.started, maxDaily) }} /></span>
                    </th>
                    <td>{formatCount(row.started)}</td>
                    <td>{formatCount(row.roomsEntered)}</td>
                    <td>{formatCount(row.roomsCompleted)}</td>
                    <td>{formatCount(row.rushStarted)}</td>
                    <td>{formatCount(row.rushFinished)}</td>
                    <td>{formatCount(row.completed)}</td>
                    <td>{formatCount(row.claimsCreated)}</td>
                    <td>{formatCount(row.verified)}</td>
                    <td>{formatCount(row.exported)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="admin-note">День — по московскому времени. Выгрузки до появления даты выгрузки учтены только в итоге воронки.</p>
      </section>

      <div className="admin-grid">
        <section aria-labelledby="levels-title" className="admin-card">
          <h2 id="levels-title">Уровни</h2>
          <ul className="levels">
            {metrics.levels.map((level) => (
              <li key={level.title}>
                <span className="funnel-label">{level.title}</span>
                <span className="a-bar"><span className="a-fill gold" style={{ width: formatPercent(level.share) === "—" ? "0%" : `${(level.share ?? 0) * 100}%` }} /></span>
                <span className="funnel-count">{formatCount(level.count)}<small> · {formatPercent(level.share)}</small></span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="timing-title" className="admin-card">
          <h2 id="timing-title">Время прохождения</h2>
          <dl className="timing">
            <div><dt>Среднее</dt><dd>{formatDuration(metrics.timing.avgSeconds)}</dd></div>
            <div><dt>Медиана</dt><dd>{formatDuration(metrics.timing.medianSeconds)}</dd></div>
            <div><dt>Завершили игру</dt><dd>{formatCount(metrics.timing.completedCount)}</dd></div>
          </dl>
          <p className="admin-note">От старта сессии до финала. Вкладка, брошенная открытой, завышает среднее; ориентируйтесь на медиану.</p>
        </section>
      </div>

      <section aria-labelledby="tasks-title" className="admin-card">
        <h2 id="tasks-title">Задания</h2>
        <ul className="tasks">
          {metrics.tasks.map((task) => (
            <li key={task.taskId}>
              <span className="task-name">
                <strong>{task.taskId}</strong>
                <small>{task.roomTitle} · {task.type}</small>
              </span>
              <span className="a-bar stacked" role="img" aria-label={`На 100: ${task.full}, на 50: ${task.partial}, на 0: ${task.wrong}`}>
                <span className="a-fill" style={{ width: widthOf(task.full, task.answers) }} />
                <span className="a-fill gold" style={{ width: widthOf(task.partial, task.answers) }} />
                <span className="a-fill coral" style={{ width: widthOf(task.wrong, task.answers) }} />
              </span>
              <span className="funnel-count">{formatPercent(task.fullShare)}<small> · {formatCount(task.answers)} отв.</small></span>
            </li>
          ))}
        </ul>
        <p className="admin-note">Доля верных — ответы на 100 баз. очков. <span className="a-legend green">100</span> <span className="a-legend gold">50</span> <span className="a-legend coral">0</span></p>
      </section>

      <section aria-labelledby="claims-title" className="admin-card">
        <div className="claims-head">
          <h2 id="claims-title">Заявки · {formatCount(claims.total)}</h2>
          <ExportButton />
        </div>
        <p className="admin-note">
          В CSV попадают подтверждённые заявки с полными данными; кнопка «Выгрузить CSV» отмечает их как «Выгружена» и скачивает файл; прямая ссылка на CSV статус не меняет.
          В таблице email скрыт.
        </p>
        <ul className="status-chips">
          {(Object.keys(CLAIM_STATUS_LABELS) as Array<keyof typeof CLAIM_STATUS_LABELS>).map((status) => (
            <li key={status}>{CLAIM_STATUS_LABELS[status]}: <strong>{formatCount(claims.byStatus[status])}</strong></li>
          ))}
        </ul>
        {claims.rows.length === 0 ? (
          <p className="admin-empty">Заявок пока нет.</p>
        ) : (
          <div className="table-scroll">
            <table className="left">
              <thead>
                <tr><th scope="col">Email</th><th scope="col">Статус</th><th scope="col">Уровень</th><th scope="col">Создана</th></tr>
              </thead>
              <tbody>
                {claims.rows.map((row, index) => (
                  <tr key={index}>
                    <th scope="row">{row.maskedEmail}</th>
                    <td>{CLAIM_STATUS_LABELS[row.status]}</td>
                    <td>{row.level ?? "—"}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {claims.total > claims.rows.length && (
          <p className="admin-note">Показаны последние {formatCount(claims.rows.length)} из {formatCount(claims.total)}.</p>
        )}
      </section>
    </main>
  );
}
