import { publicAdvent } from "@/server/presentation";
import type { AdventConfig } from "@/config/advent-schema";
import type { AdventState, PublicAdvent } from "@/types/advent";

import { adventConfig, at } from "./advent";
import { memoryAdventApi } from "./advent-client";

export const config = adventConfig();
export const publicConfig: PublicAdvent = publicAdvent(config, "zerno-advent", "snow-globe");

/** Подмена `matchMedia`: `prefers-reduced-motion: reduce` включён или нет. */
export function mockReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

/** Участник, открывший день 1 в сам день, на день 4: есть двери всех пяти статусов. */
export async function fiveStatusState(advent: AdventConfig = config): Promise<AdventState> {
  const harness = memoryAdventApi({ advent, start: at(1) });
  await harness.ensureParticipant();
  await harness.api.openDay(1);
  harness.clock.now = at(4);
  return harness.api.getState();
}
