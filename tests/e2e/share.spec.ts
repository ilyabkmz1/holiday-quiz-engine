import { campaign } from "./support/tenant";
import { localEnv } from "./support/env";
import { expect, test } from "./support/fixtures";
import { createSessionViaApi } from "./support/api";
import { finishGameViaApi } from "./support/operator";

const meta = (html: string, attribute: "property" | "name", key: string): string | undefined =>
  html.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`))?.[1];

test.describe("страница результата для «Поделиться»", () => {
  test("после завершённой игры отдаёт Open Graph и Twitter-метатеги и кнопку «Сыграть самому»", async ({ page, request }) => {
    const sessionId = await finishGameViaApi(page);
    const { session } = (await (await page.request.get(`/api/sessions/${sessionId}`)).json()) as { session: { final: { score: number; level: { title: string } } } };

    const response = await request.get(`/share/${sessionId}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    const imageUrl = `${localEnv.APP_URL}/share/${sessionId}/image`;
    expect(meta(html, "property", "og:title")).toContain(session.final.level.title);
    expect(meta(html, "property", "og:image")).toBe(imageUrl);
    expect(meta(html, "property", "og:image:width")).toBe("1200");
    expect(meta(html, "property", "og:image:height")).toBe("630");
    expect(meta(html, "property", "og:url")).toBe(`${localEnv.APP_URL}/share/${sessionId}`);
    expect(meta(html, "name", "twitter:card")).toBe("summary_large_image");
    expect(meta(html, "name", "twitter:image")).toBe(imageUrl);
    expect(html).toContain(campaign.title);

    await page.goto(`/share/${sessionId}`);
    const play = page.getByRole("link", { name: "Сыграть самому" });
    await expect(play).toBeVisible();
    await expect(play).toHaveAttribute("href", "/");
    await expect(page.getByText(session.final.level.title).first()).toBeVisible();
  });

  test("картинка результата — PNG 1200×630", async ({ page, request }) => {
    const sessionId = await finishGameViaApi(page);
    const image = await request.get(`/share/${sessionId}/image`);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
    const bytes = await image.body();
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });

  test("для незавершённой и несуществующей сессии — 404 и страница, и картинка", async ({ page, request }) => {
    const playing = await createSessionViaApi(page);
    for (const id of [playing, "00000000-0000-4000-8000-000000000000", "not-a-session"]) {
      expect((await request.get(`/share/${id}`)).status(), id).toBe(404);
      expect((await request.get(`/share/${id}/image`)).status(), id).toBe(404);
    }
  });

  test("страница результата не раскрывает ничего, кроме итога", async ({ page, request }) => {
    const sessionId = await finishGameViaApi(page);
    const html = await (await request.get(`/share/${sessionId}`)).text();
    expect(html).not.toMatch(/quiz_session_access|accessKey|@example\.test|"email"/);
  });
});
