// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdventReminderLogin, REMINDER_LOGIN_ACTION } from "@/components/advent/AdventReminderLogin";

import { adventConfig } from "../support/advent";

afterEach(cleanup);

const DELIVERY = "11111111-2222-4333-8444-555555555555";

describe("AdventReminderLogin (кнопка письма на устройстве без входа)", () => {
  const advent = adventConfig();

  it("«Чтобы открыть дверь N, войдите»: форма POST с идентификатором доставки, без поля email и без адреса на странице", () => {
    const { container } = render(<AdventReminderLogin advent={advent} view={{ kind: "ask", delivery: DELIVERY, day: 4, notice: null }} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Чтобы открыть дверь 4, войдите");
    const button = screen.getByRole("button", { name: advent.copy.reminderLoginButton });
    const form = button.closest("form")!;
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", REMINDER_LOGIN_ACTION);
    expect(container.querySelector('input[type="hidden"][name="r"]')).toHaveValue(DELIVERY);
    expect(container.querySelector('input[type="email"], input[name="email"]')).toBeNull();
    expect(container.textContent).not.toContain("@");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("лимит и сбой отправки — сообщение, кнопка остаётся", () => {
    const { rerender } = render(<AdventReminderLogin advent={advent} view={{ kind: "ask", delivery: DELIVERY, day: 4, notice: "limited" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(advent.copy.reminderLoginLimited);
    rerender(<AdventReminderLogin advent={advent} view={{ kind: "ask", delivery: DELIVERY, day: null, notice: "failed" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(advent.copy.saveErrorSend);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Чтобы открыть дверь, войдите");
    expect(screen.getByRole("button", { name: advent.copy.reminderLoginButton })).toBeInTheDocument();
  });

  it("после отправки — «проверьте почту» без адреса; битая ссылка — на главную", () => {
    const { rerender } = render(<AdventReminderLogin advent={advent} view={{ kind: "sent" }} />);
    expect(screen.getByRole("heading", { level: 1, name: advent.copy.reminderLoginSentTitle })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<AdventReminderLogin advent={advent} view={{ kind: "invalid" }} />);
    expect(screen.getByText(advent.copy.reminderLoginInvalid)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "На главную" })).toHaveAttribute("href", "/");
  });

  it("«Витрина» говорит об окне", () => {
    const store = adventConfig((draft) => {
      draft.presentation = "storefront";
      draft.facade = { templateId: "cafe" };
    });
    render(<AdventReminderLogin advent={store} view={{ kind: "ask", delivery: DELIVERY, day: 2, notice: null }} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Чтобы открыть окно 2, войдите");
  });
});
