import { packSchema } from "@/config/pack";

import { campaign } from "./campaign";

// Эталонный демо-пакет квеста: вымышленная компания «Северный офис» в мире snow-globe.
// Поведение этого пакета — регрессионная база движка (на нём держатся unit-, интеграционные и e2e-тесты).
export const pack = packSchema.parse({
  tenant: "demo-office",
  hosts: [],
  worldId: "snow-globe",
  campaign
});
