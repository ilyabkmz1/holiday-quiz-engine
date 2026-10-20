// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromoCard } from "@/components/advent/PromoCard";
import type { AdventGrantView } from "@/types/advent";

import { config } from "../support/advent-ui";

const NOW = Date.parse("2026-12-22T12:00:00+03:00");

const grant: AdventGrantView = {
  id: "g1", source: "day", day: 3, rewardId: "daily-gift", kind: "gift", label: "Напиток или десерт дня", description: "Покажите код на кассе.",
  status: "issued", expiresAt: "2026-12-24T12:00:00.000Z", code: "ZR4F7K", grantedAt: "2026-12-22T09:00:00.000Z", redeemedAt: null, redeem: "cashier",
  url: null, needsIdentity: false, codePending: false, qr: { payload: "ADV1.g1.sig", url: "https://advent.test/redeem?code=ADV1.g1.sig" }
};

function mount(patch: Partial<AdventGrantView> = {}, extra: { onNeedIdentity?: () => void } = {}) {
  return render(<PromoCard grant={{ ...grant, ...patch }} copy={config.copy} timezone="Europe/Moscow" nowMs={NOW} {...extra} />);
}

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PromoCard: код и срок", () => {
  it("показывает название, описание, код и срок действия по времени кампании", () => {
    mount();
    expect(screen.getByRole("heading", { level: 3, name: grant.label })).toBeInTheDocument();
    expect(screen.getByText(grant.description)).toBeInTheDocument();
    expect(screen.getByTestId("promo-code")).toHaveTextContent("ZR4F7K");
    // 12:00 UTC — это 15:00 в Москве.
    // Разделитель даты и времени («, » или « в ») зависит от версии ICU.
    expect(screen.getByText(/^Действует до 24 декабря,? (в )?15:00$/)).toBeInTheDocument();
  });

  it("«Скопировать» кладёт код в буфер и сообщает об этом в живом регионе", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mount();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: config.copy.promoCopy })));
    expect(writeText).toHaveBeenCalledWith("ZR4F7K");
    expect(screen.getByRole("status")).toHaveTextContent(config.copy.promoCopied);
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("если буфер недоступен, код выделяется для ручного копирования и выводится подсказка", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    mount();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: config.copy.promoCopy })));
    expect(screen.getByRole("status")).toHaveTextContent(config.copy.promoCopyFailed);
    expect(window.getSelection()?.toString()).toBe("ZR4F7K");
  });
});

describe("PromoCard: QR для кассы", () => {
  it("QR с подписью для cashier и both, пока награда действует", () => {
    const { container, rerender } = mount();
    const svg = screen.getByRole("img", { name: config.copy.promoQrLabel });
    expect(svg).toBeInTheDocument();
    expect(container.querySelector(".adv-qr path")?.getAttribute("d")).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    expect(screen.getByText(config.copy.promoCashier)).toBeInTheDocument();
    rerender(<PromoCard grant={{ ...grant, redeem: "both" }} copy={config.copy} timezone="Europe/Moscow" nowMs={NOW} />);
    expect(screen.getByRole("img", { name: config.copy.promoQrLabel })).toBeInTheDocument();
  });

  it("без QR для online и none, при погашении и после истечения срока", () => {
    for (const patch of [{ redeem: "online" as const }, { redeem: "none" as const }, { status: "redeemed" as const, redeemedAt: "2026-12-22T10:00:00.000Z" }, { expiresAt: "2026-12-22T08:00:00.000Z" }, { qr: null }]) {
      const { unmount } = mount(patch);
      expect(screen.queryByRole("img", { name: config.copy.promoQrLabel })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("погашен и просрочен: вместо срока — отметка, карточка помечена", () => {
    const redeemed = mount({ status: "redeemed", redeemedAt: "2026-12-22T10:00:00.000Z" });
    expect(screen.getByText(/^Использован 22 декабря,? (в )?13:00$/)).toBeInTheDocument();
    expect(redeemed.container.querySelector("article")).toHaveAttribute("data-condition", "redeemed");
    redeemed.unmount();
    mount({ expiresAt: "2026-12-22T08:00:00.000Z" });
    expect(screen.getByText(config.copy.promoExpired)).toBeInTheDocument();
  });
});

describe("PromoCard: ссылка, ожидание кода", () => {
  it("online: ссылка открывается в новой вкладке с rel noopener noreferrer", () => {
    mount({ redeem: "online", url: "https://shop.example/promo", qr: null });
    const link = screen.getByRole("link", { name: new RegExp(config.copy.promoOnline) });
    expect(link).toHaveAttribute("href", "https://shop.example/promo");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("ссылка не http/https (javascript:, data:) не попадает в href", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "not a url"]) {
      const { unmount } = mount({ redeem: "online", url, qr: null });
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("до входа по ссылке кода нет: пояснение и кнопка «Сохранить прогресс»", () => {
    const onNeedIdentity = vi.fn();
    mount({ code: null, qr: null, expiresAt: null, needsIdentity: true }, { onNeedIdentity });
    expect(screen.queryByTestId("promo-code")).not.toBeInTheDocument();
    expect(screen.getByText(config.copy.promoNeedsIdentity)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: config.copy.saveTitle }));
    expect(onNeedIdentity).toHaveBeenCalled();
  });

  it("пул кодов пуст: «код появится совсем скоро»", () => {
    mount({ code: null, qr: null, codePending: true });
    expect(screen.getByText(config.copy.promoCodePending)).toBeInTheDocument();
  });
});
