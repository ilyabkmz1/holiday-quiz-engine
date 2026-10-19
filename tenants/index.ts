import { pack as demoOffice } from "./demo-office/pack";
import demoCoffee from "./demo-coffee/pack.json" with { type: "json" };
// quiz:new-import

/**
 * Манифест пакетов, собранных в образ. Список статический: бандлер Next должен видеть импорты,
 * а не сканировать диск во время работы. `npm run quiz:new` дописывает сюда новый пакет (по маркерам-комментариям).
 * Элементы — сырые данные пакета (TS-модуль или pack.json): каждый проверяется схемой при старте (`loadTenants`).
 */
export const packs: unknown[] = [
  demoOffice,
  demoCoffee,
  // quiz:new-append
];
