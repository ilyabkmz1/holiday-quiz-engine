import { getAdventServices } from "@/server/container";
import type { AdventTenant } from "@/server/tenants";

import { CodeImport } from "./CodeImport";
import { formatCount } from "./format";

/**
 * Панель оператора адвент-арендатора: выдано и погашено по наградам, остатки удачи, свободные коды в пулах,
 * загрузка кодов и выгрузка выдач. Только числа: ни email, ни кодов участников здесь нет.
 */
export async function AdventAdmin({ tenant }: { tenant: AdventTenant }) {
  const { advent } = tenant;
  const { rewardService } = getAdventServices(tenant);
  const rows = await rewardService.overview();
  const listRewards = new Set(advent.rewards.filter((reward) => reward.codes && "list" in reward.codes).map((reward) => reward.id));

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <p className="admin-eyebrow">Панель оператора · адвент</p>
          <h1>{advent.title}</h1>
        </div>
        <p className="admin-note">Только агрегаты, без email и кодов участников.</p>
      </header>

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
    </main>
  );
}
