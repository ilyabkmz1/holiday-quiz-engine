// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaimForm } from "@/components/game/ClaimForm";
import { legal } from "@tenants/demo-office/legal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ClaimForm", () => {
  it("submits the contact fields and shows the verification instruction", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "claim_pending", created: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    render(<ClaimForm sessionId="session-1" consentText={legal.consentText} />);

    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Иван" } });
    fireEvent.change(screen.getByLabelText("Компания"), { target: { value: "Партнёр" } });
    fireEvent.change(screen.getByLabelText("Корпоративный email"), { target: { value: "ivan@example.com" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Получить ссылку подтверждения" }).closest("form")!);

    await waitFor(() => expect(screen.getByText("Письмо уже в пути")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/session-1/claim",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      name: "Иван",
      email: "ivan@example.com",
      company: "Партнёр",
      consent: true
    });
  });

  it("returns to an actionable form after a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    render(<ClaimForm sessionId="session-1" consentText={legal.consentText} />);

    fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "Иван" } });
    fireEvent.change(screen.getByLabelText("Компания"), { target: { value: "Партнёр" } });
    fireEvent.change(screen.getByLabelText("Корпоративный email"), { target: { value: "ivan@example.com" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "Получить ссылку подтверждения" }).closest("form")!);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Не удалось отправить заявку"));
    expect(screen.getByRole("button", { name: "Получить ссылку подтверждения" })).toBeEnabled();
  });
});

describe("ClaimForm consent", () => {
  it("shows the legal consent text with a link to the policy", () => {
    render(<ClaimForm sessionId="session-1" consentText={legal.consentText} />);
    expect(screen.getByText(new RegExp(legal.consentText.slice(0, 40).replace(/[[\]]/g, "\\$&")))).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Политика обработки данных" });
    expect(link).toHaveAttribute("href", "/privacy");
  });
});
