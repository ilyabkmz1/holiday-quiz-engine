import { apiError } from "@/server/api";
import { getPrisma } from "@/server/db";
import { getRuntimeEnv, isStagingEnabled } from "@/server/env";
import { getCachedShareImage, renderShareImage } from "@/server/share-image";
import { loadShareSummary, normalizeShareSessionId } from "@/server/share";
import { tenantFromHeaders } from "@/server/tenants";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

function pngResponse(png: Uint8Array): Response {
  // Итог завершённой игры не меняется: на открытом сайте даём кэшировать соцсетям и CDN. На закрытом стенде
  // ответ только для того, у кого есть staging-пароль, поэтому общий кэш (CDN) ему не нужен.
  const cacheControl = isStagingEnabled(getRuntimeEnv()) ? "private, max-age=3600" : "public, max-age=3600, s-maxage=86400";
  return new Response(png as BodyInit, {
    headers: { "content-type": "image/png", "content-length": String(png.byteLength), "cache-control": cacheControl }
  });
}

/**
 * Картинка результата 1200×630. Только публичный итог завершённой сессии; для остальных — 404.
 * Query-параметры игнорируются (ни на рендер, ни на кэш не влияют); готовые PNG лежат в LRU по кампании и id сессии:
 * картинка сессии одного арендатора не отдаётся по домену другого.
 */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const sessionId = normalizeShareSessionId((await params).sessionId);
    if (!sessionId) return notFound();
    const { campaign } = tenantFromHeaders(request.headers);
    const cacheKey = `${campaign.slug}/${sessionId}`;
    const cached = getCachedShareImage(cacheKey);
    if (cached) return pngResponse(cached);
    const summary = await loadShareSummary(getPrisma(), campaign, sessionId);
    if (!summary) return notFound();
    return pngResponse(await renderShareImage(cacheKey, summary, campaign.brand));
  } catch (error) {
    return apiError(error);
  }
}
