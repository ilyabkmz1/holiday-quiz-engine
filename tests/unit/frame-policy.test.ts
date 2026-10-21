import { afterEach, describe, expect, it } from "vitest";

import { packSchema } from "@/config/pack";
import { frameHeaders, TELEGRAM_FRAME_ORIGINS } from "@/server/frame-policy";
import { loadTenants, overrideTenants } from "@/server/tenants";

import { adventPackFixture } from "../fixtures/advent";
import { smallCampaign } from "../support/small-campaign";

const telegram = { botUsername: "zerno_advent_bot", appShortName: "advent" };
const DENY = { "Content-Security-Policy": "frame-ancestors 'none'", "X-Frame-Options": "DENY" };

afterEach(() => overrideTenants(null));

function tenants() {
  const base = adventPackFixture();
  overrideTenants(
    loadTenants([
      // Без TENANT чужой хост вне production показывает первый пакет: политика следует за тем, что реально отдаётся.
      { ...base, tenant: "plain-advent", hosts: ["plain.test"], advent: { ...base.advent, slug: "plain-advent-campaign" } },
      { ...base, hosts: ["tg.test"], platforms: { telegram } },
      packSchema.parse({ tenant: "quiz", hosts: ["quiz.test"], campaign: smallCampaign("quiz-campaign") })
    ])
  );
}

describe("защита от встраивания", () => {
  it("адвент с Telegram пускает только фреймы Telegram Web и свой сайт, без X-Frame-Options", () => {
    tenants();
    const headers = frameHeaders("tg.test", "/");
    expect(headers["X-Frame-Options"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).toBe(`frame-ancestors 'self' ${TELEGRAM_FRAME_ORIGINS.join(" ")}`);
    expect(headers["Content-Security-Policy"]).not.toContain("*");
    expect(frameHeaders("tg.test", "/privacy")["X-Frame-Options"]).toBeUndefined();
  });

  it("операторские и служебные пути никогда не встраиваются, даже у Telegram-арендатора", () => {
    tenants();
    for (const path of ["/admin", "/admin/anything", "/api/advent/state", "/redeem", "/redeem/x"]) expect(frameHeaders("tg.test", path)).toEqual(DENY);
    expect(frameHeaders("tg.test", "/administrators")["X-Frame-Options"]).toBeUndefined();
  });

  it("адвент без Telegram, квиз и неизвестный хост — запрет встраивания", () => {
    tenants();
    expect(frameHeaders("plain.test", "/")).toEqual(DENY);
    expect(frameHeaders("quiz.test", "/")).toEqual(DENY);
    expect(frameHeaders("unknown.test", "/")).toEqual(DENY);
    expect(frameHeaders(null, "/")).toEqual(DENY);
  });
});
