import { randomUUID } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as imageGET } from "@/app/share/[sessionId]/image/route";
import SharePage, { generateMetadata } from "@/app/share/[sessionId]/page";
import { campaign } from "@tenants/demo-office/campaign";
import { getPrisma } from "@/server/db";
import { resetShareImageCache, shareImageCacheSize } from "@/server/share-image";
import * as shareModule from "@/server/share";
import { loadShareSummary } from "@/server/share";
import { shareImageUrl, shareUrl } from "@/server/urls";

import {
  completedPlayer,
  installFakes,
  PERFECT_FIXED_CLOCK_SCORE,
  startSession,
  verifiedClaim
} from "./helpers/app";
import { TEST_APP_URL } from "./helpers/constants";

// Страницы читают Host запроса, чтобы выбрать арендатора; вне Next запроса нет, поэтому заголовки подменены.
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));

const imageRequest = (sessionId: string, query = "") => imageGET(new Request(`${TEST_APP_URL}/share/${sessionId}/image${query}`), { params: Promise.resolve({ sessionId }) });
const params = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) });
const isNotFound = (error: unknown) => String((error as { digest?: string }).digest).includes("404");

async function pageNotFound(sessionId: string): Promise<boolean> {
  try {
    await SharePage(params(sessionId));
    return false;
  } catch (error) {
    return isNotFound(error);
  }
}

describe("loadShareSummary", () => {
  it("returns only the public result of a completed session", async () => {
    installFakes();
    const player = await completedPlayer();

    const summary = await loadShareSummary(getPrisma(), campaign, player.sessionId);

    expect(summary).toEqual({
      score: PERFECT_FIXED_CLOCK_SCORE,
      tierTitle: campaign.rewardTiers.at(-1)!.title,
      campaignTitle: campaign.title
    });
  });

  it("is null for an unfinished session, an unknown id, garbage and another campaign", async () => {
    installFakes();
    const playing = await startSession();
    const done = await completedPlayer();

    expect(await loadShareSummary(getPrisma(), campaign, playing.sessionId)).toBeNull();
    expect(await loadShareSummary(getPrisma(), campaign, randomUUID())).toBeNull();
    for (const garbage of ["", "abc", "../admin", "'; DROP TABLE \"GameSession\"; --", `${done.sessionId}x`, "0".repeat(36)]) {
      expect(await loadShareSummary(getPrisma(), campaign, garbage), garbage).toBeNull();
    }
    expect(await loadShareSummary(getPrisma(), { ...campaign, slug: "other" }, done.sessionId)).toBeNull();
  });

  it("accepts the id in upper case and still exposes nothing but the result", async () => {
    installFakes();
    const done = await completedPlayer();

    const summary = await loadShareSummary(getPrisma(), campaign, done.sessionId.toUpperCase());

    expect(Object.keys(summary ?? {}).sort()).toEqual(["campaignTitle", "score", "tierTitle"]);
  });
});

describe("GET /share/:sessionId/image", () => {
  beforeEach(() => resetShareImageCache());

  it("renders a 1200x630 PNG for a completed session", async () => {
    installFakes();
    const player = await completedPlayer();

    const response = await imageRequest(player.sessionId);
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toMatch(/public/);
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    // Фон и текст реально нарисованы: пустая заливка PNG была бы в разы меньше.
    expect(bytes.length).toBeGreaterThan(30_000);
  });

  it("answers 404 without caching for an unfinished or unknown session", async () => {
    installFakes();
    const playing = await startSession();

    for (const id of [playing.sessionId, randomUUID(), "not-a-uuid"]) {
      const response = await imageRequest(id);
      expect(response.status, id).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).not.toMatch(/image/);
    }
  });
});

describe("GET /share/:sessionId/image: кэш", () => {
  beforeEach(() => resetShareImageCache());

  it("второй запрос отдаёт тот же PNG из LRU без обращения к БД и без повторного рендера", async () => {
    installFakes();
    const player = await completedPlayer();
    const load = vi.spyOn(shareModule, "loadShareSummary");

    const first = Buffer.from(await (await imageRequest(player.sessionId)).arrayBuffer());
    expect(shareImageCacheSize()).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    const second = await imageRequest(player.sessionId);

    expect(second.status).toBe(200);
    expect(second.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await second.arrayBuffer()).equals(first)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(shareImageCacheSize()).toBe(1);
  });

  it("игнорирует query-параметры и регистр id: одна запись кэша", async () => {
    installFakes();
    const player = await completedPlayer();

    await imageRequest(player.sessionId);
    for (const variant of [`${player.sessionId}`, player.sessionId.toUpperCase()]) {
      for (const query of ["?v=1", "?v=2&x=y", "?w=1&h=1"]) {
        expect((await imageRequest(variant, query)).status).toBe(200);
      }
    }
    expect(shareImageCacheSize()).toBe(1);
  });

  it("параллельные запросы одной картинки делят один рендер, 404 не кэшируется", async () => {
    installFakes();
    const player = await completedPlayer();

    const responses = await Promise.all([1, 2, 3, 4].map(() => imageRequest(player.sessionId)));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(shareImageCacheSize()).toBe(1);

    expect((await imageRequest(randomUUID())).status).toBe(404);
    expect(shareImageCacheSize()).toBe(1);
  });
});

describe("/share/:sessionId page", () => {
  it("publishes Open Graph and Twitter metadata with an absolute image URL", async () => {
    installFakes();
    const player = await completedPlayer();

    const metadata = await generateMetadata(params(player.sessionId));

    expect(String(metadata.title)).toContain(" очков");
    expect(String(metadata.title)).toContain(campaign.rewardTiers.at(-1)!.title);
    expect(metadata.openGraph).toMatchObject({
      url: shareUrl(player.sessionId, TEST_APP_URL),
      images: [{ url: shareImageUrl(player.sessionId, TEST_APP_URL), width: 1200, height: 630 }]
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", images: [shareImageUrl(player.sessionId, TEST_APP_URL)] });
    expect(shareImageUrl(player.sessionId, TEST_APP_URL)).toBe(`${TEST_APP_URL}/share/${player.sessionId}/image`);
  });

  it("нормализует id в нижний регистр для canonical и og:url", async () => {
    installFakes();
    const player = await completedPlayer();

    const metadata = await generateMetadata(params(player.sessionId.toUpperCase()));

    expect(metadata.alternates?.canonical).toBe(shareUrl(player.sessionId, TEST_APP_URL));
    expect(metadata.openGraph).toMatchObject({ url: shareUrl(player.sessionId, TEST_APP_URL) });
    expect(metadata.twitter).toMatchObject({ images: [shareImageUrl(player.sessionId, TEST_APP_URL)] });
  });

  it("renders for a completed session and is 404 for an unfinished one", async () => {
    installFakes();
    const done = await completedPlayer();
    const playing = await startSession();

    expect(await pageNotFound(done.sessionId)).toBe(false);
    expect(await pageNotFound(playing.sessionId)).toBe(true);
    expect(await pageNotFound(randomUUID())).toBe(true);
    const missing = await generateMetadata(params(playing.sessionId));
    expect(missing.openGraph).toBeUndefined();
    expect(missing.robots).toMatchObject({ index: false });
  });

  it("carries no personal data of the player in metadata, summary or markup", async () => {
    const mailer = installFakes();
    const { player, input } = await verifiedClaim(mailer, { email: "private.person@example.com", name: "Секретная Персона", company: "Скрытая Компания" });

    const summary = await loadShareSummary(getPrisma(), campaign, player.sessionId);
    const metadata = await generateMetadata(params(player.sessionId));
    const page = await SharePage(params(player.sessionId));
    const dump = JSON.stringify([summary, metadata]) + renderToStaticMarkup(page);

    for (const secret of [input.email.toLowerCase(), "private.person", "Секретная", "Скрытая", player.accessKey]) {
      expect(dump).not.toContain(secret);
    }
  });
});
