// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderInWorld as render } from "./world-render";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RushScreen } from "@/components/game/RushScreen";
import { campaign as config } from "@tenants/demo-office/campaign";
import { publicCampaign } from "@/server/presentation";
import type { RushState } from "@/types/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const campaign = publicCampaign(config);
const firstService = campaign.rush.services[0];

function rushState(overrides: Partial<RushState> = {}): RushState {
  const now = new Date();
  return {
    status: "running",
    startedAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + 30_000).toISOString(),
    serverNow: now.toISOString(),
    secondsLeft: 30,
    answered: 0,
    hits: 0,
    misses: 0,
    points: 0,
    total: 20,
    current: { itemId: "item-1", prompt: "Первая заявка", index: 0 },
    ...overrides
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("RushScreen", () => {
  it("отправляет ответ на текущую заявку и показывает следующую", async () => {
    const next = rushState({ answered: 1, hits: 1, points: 20, current: { itemId: "item-2", prompt: "Вторая заявка", index: 1 } });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ correct: true, scoreDelta: 20, score: 20, rush: next }));
    const onScore = vi.fn();
    render(<RushScreen campaign={campaign} sessionId="s1" initial={rushState()} score={0} onScore={onScore} onDone={() => undefined} onError={() => undefined} />);

    expect(screen.getByText("Первая заявка")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: firstService.title }));

    await waitFor(() => expect(screen.getByText("Вторая заявка")).toBeInTheDocument());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ itemId: "item-1", serviceId: firstService.id });
    expect(onScore).toHaveBeenCalledWith(20);
  });

  it("секунды 0 в окне допуска сервера (status running) — конец раунда: кнопки заблокированы, вызывается finish", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ rush: rushState({ status: "finished" }), score: 0 }));
    const onDone = vi.fn();
    const expiredNow = new Date();
    render(
      <RushScreen
        campaign={campaign}
        sessionId="s1"
        initial={rushState({ secondsLeft: 0, deadlineAt: new Date(expiredNow.getTime() + 1500).toISOString() })}
        score={0}
        onScore={() => undefined}
        onDone={onDone}
        onError={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: firstService.title })).toBeDisabled();
    expect(screen.getByText("Время вышло")).toBeInTheDocument();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/sessions/s1/rush/finish");
  });

  it("повторяет finish после сетевого сбоя и в итоге переходит к итогам", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response("{}", { status: 503, headers: { "content-type": "application/json" } }))
      .mockResolvedValue(json({ rush: rushState({ status: "finished" }), score: 0 }));
    const onDone = vi.fn();
    const onError = vi.fn();
    render(
      <RushScreen
        campaign={campaign}
        sessionId="s1"
        initial={rushState({ secondsLeft: 0, deadlineAt: new Date(Date.now() - 100).toISOString() })}
        score={0}
        onScore={() => undefined}
        onDone={onDone}
        onError={onError}
      />
    );

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it("если finish не удаётся совсем, всё равно переходит к итогам: complete закроет рывок на сервере", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const onDone = vi.fn();
    render(
      <RushScreen
        campaign={campaign}
        sessionId="s1"
        initial={rushState({ secondsLeft: 0, deadlineAt: new Date(Date.now() - 100).toISOString() })}
        score={0}
        onScore={() => undefined}
        onDone={onDone}
        onError={() => undefined}
      />
    );

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 8000 });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  }, 10_000);

  it("не вызывает onDone после размонтирования во время повторов", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const onDone = vi.fn();
    const view = render(
      <RushScreen
        campaign={campaign}
        sessionId="s1"
        initial={rushState({ secondsLeft: 0, deadlineAt: new Date(Date.now() - 100).toISOString() })}
        score={0}
        onScore={() => undefined}
        onDone={onDone}
        onError={() => undefined}
      />
    );
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("держит постоянный живой регион для заявки: он не пересоздаётся при смене заявки", async () => {
    const next = rushState({ answered: 1, hits: 1, points: 20, current: { itemId: "item-2", prompt: "Вторая заявка", index: 1 } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ correct: true, scoreDelta: 20, score: 20, rush: next }));
    render(<RushScreen campaign={campaign} sessionId="s1" initial={rushState()} score={0} onScore={() => undefined} onDone={() => undefined} onError={() => undefined} />);

    const region = screen.getByText("Первая заявка").closest('[aria-live="polite"]');
    expect(region).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: firstService.title }));
    await waitFor(() => expect(screen.getByText("Вторая заявка")).toBeInTheDocument());
    expect(screen.getByText("Вторая заявка").closest('[aria-live="polite"]')).toBe(region);
  });
});
