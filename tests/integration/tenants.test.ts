import { beforeEach, describe, expect, it, vi } from "vitest";

import { packSchema } from "@/config/pack";
import { overrideTenants, type Tenant } from "@/server/tenants";
import { campaign as officeCampaign } from "@tenants/demo-office/campaign";

import { installFakes, makeRequest } from "./helpers/app";
import { POST as createSession } from "@/app/api/sessions/route";
import { smallCampaign } from "../support/small-campaign";

const office = packSchema.parse({ tenant: "demo-office", hosts: ["office.test"], campaign: officeCampaign }) as Tenant;
const second = packSchema.parse({ tenant: "second", hosts: ["second.test"], campaign: smallCampaign("second-campaign") }) as Tenant;

async function startOn(host: string) {
  const response = await createSession(
    makeRequest("/api/sessions", { method: "POST", origin: `https://${host}`, headers: { host } })
  );
  return response;
}

describe("несколько арендаторов в одной БД", () => {
  beforeEach(() => {
    installFakes();
    overrideTenants([office, second]);
    return () => overrideTenants(null);
  });

  it("кампания определяется по Host, а сессия видна только на своём домене", async () => {
    const created = await startOn("second.test");
    expect(created.status).toBe(200);
    const body = (await created.json()) as { sessionId: string; campaign: { slug: string; rooms: unknown[] } };
    expect(body.campaign.slug).toBe("second-campaign");
    expect(body.campaign.rooms).toHaveLength(3);
    const cookie = created.cookies.get("quiz_session_access")!.value;

    const { GET } = await import("@/app/api/sessions/[id]/route");
    const own = await GET(
      makeRequest(`/api/sessions/${body.sessionId}`, { cookie, headers: { host: "second.test" } }),
      { params: Promise.resolve({ id: body.sessionId }) }
    );
    expect(own.status).toBe(200);
  });

  it("чужой Host не открывает сессию: 404, как у несуществующей", async () => {
    const created = await startOn("second.test");
    const { sessionId } = (await created.json()) as { sessionId: string };
    const cookie = created.cookies.get("quiz_session_access")!.value;
    const { GET } = await import("@/app/api/sessions/[id]/route");
    const foreign = await GET(
      makeRequest(`/api/sessions/${sessionId}`, { cookie, headers: { host: "office.test" } }),
      { params: Promise.resolve({ id: sessionId }) }
    );
    expect(foreign.status).toBe(404);
  });

  it("поддомен общего домена — собственный Origin арендатора", async () => {
    vi.stubEnv("TENANT_BASE_DOMAIN", "quiz.example.org");
    const created = await startOn("second.quiz.example.org");
    expect(created.status).toBe(200);
    expect(((await created.json()) as { campaign: { slug: string } }).campaign.slug).toBe("second-campaign");
    vi.unstubAllEnvs();
  });

  it("Origin чужой страницы на домене арендатора отклоняется, собственный принимается", async () => {
    const evil = await createSession(makeRequest("/api/sessions", { method: "POST", origin: "https://evil.test", headers: { host: "second.test" } }));
    expect(evil.status).toBe(403);
    expect((await startOn("office.test")).status).toBe(200);
  });
});
