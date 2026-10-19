// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionBoot } from "@/components/play/useSessionBoot";
import { campaign, finalSession, json } from "./quest-fixtures";

beforeEach(() => window.localStorage.setItem("hqe-holiday-quiz-session", "s1"));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("восстановление сессии при перезагрузке", () => {
  it("решение «куда вернуть игрока» принимает один запуск, даже когда dev StrictMode запускает эффект дважды", async () => {
    // Регрессия e2e recovery.spec.ts:66 в dev: первый ответ открывал разбор и отмечал его прочитанным, второй уводил на карту.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ campaign, session: finalSession() }));
    const onResume = vi.fn();
    const { result } = renderHook(() => useSessionBoot({ campaign, onResume, onForget: () => undefined }), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.session).not.toBeNull());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    // Дождаться ответа неотменённого запуска и дать отработать обоим ответам: onResume должен прийти ровно один раз.
    await waitFor(() => expect(onResume).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("без StrictMode — тоже один раз", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ campaign, session: finalSession() }));
    const onResume = vi.fn();
    const { result } = renderHook(() => useSessionBoot({ campaign, onResume, onForget: () => undefined }));
    await waitFor(() => expect(result.current.session).not.toBeNull());
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
