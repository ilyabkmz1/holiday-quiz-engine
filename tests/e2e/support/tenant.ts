import { packSchema } from "../../../src/config/pack";
import { packs } from "../../../tenants/index";

/**
 * Арендатор, на котором идёт прогон: `E2E_TENANT=<slug> npm run test:e2e` (по умолчанию эталонный demo-office).
 * Сервер поднимается с `TENANT=<slug>` (см. env.ts), а тесты берут тексты и селекторы из его пакета, а не из захардкоженных строк.
 */
export const tenantSlug = process.env.E2E_TENANT ?? "demo-office";

const raw = (packs as Array<{ tenant?: string }>).find((item) => item.tenant === tenantSlug);
if (!raw) throw new Error(`E2E_TENANT=${tenantSlug}: такого пакета нет в tenants/index.ts`);

export const pack = packSchema.parse(raw);
export const campaign = pack.campaign;
export const { brand, story, copy } = campaign;
export const rooms = campaign.rooms;

/** Основной режим `/` — квест; у кампаний `mode: "cards"` главная показывает карточки. Квест-сценарии идут только на квест-кампаниях. */
export const isQuestTenant = campaign.mode === "quest";

/** Герой пролога (его реплики идут в облачках и на карточках). */
export const prologueHero = campaign.heroes.find((hero) => hero.id === campaign.prologue.heroId) ?? campaign.heroes[0];

/** «Игрушки на ёлку: 1 из N» на карте режима карточек. */
export const ornamentsCounter = (done: number) => `${copy.ornamentsMapLabel}: ${done} из ${rooms.length}`;
