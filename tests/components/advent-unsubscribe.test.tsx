// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdventUnsubscribe, UNSUBSCRIBE_FORM_ACTION } from "@/components/advent/AdventUnsubscribe";

import { adventConfig } from "../support/advent";

afterEach(cleanup);

describe("AdventUnsubscribe (страница отписки)", () => {
  const advent = adventConfig();
  const token = "t".repeat(43);

  it("подтверждение: кнопка «Отписаться» — форма POST без JavaScript, токен в скрытом поле; GET ничего не меняет", () => {
    const { container } = render(<AdventUnsubscribe advent={advent} view="confirm" token={token} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Отписаться от напоминаний?");
    const button = screen.getByRole("button", { name: "Отписаться" });
    const form = button.closest("form")!;
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", UNSUBSCRIBE_FORM_ACTION);
    expect(container.querySelector('input[type="hidden"][name="t"]')).toHaveValue(token);
    expect(screen.getByText(advent.brand.topNote)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Остаться/ })).toHaveAttribute("href", "/");
    // Прогресс и награды остаются.
    expect(screen.getByText(/прогресс и награды останутся/i)).toBeInTheDocument();
  });

  it("готово: подтверждение без формы и без токена", () => {
    const { container } = render(<AdventUnsubscribe advent={advent} view="done" token={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Вы отписались" })).toBeInTheDocument();
    expect(container.querySelector("form")).toBeNull();
    expect(screen.getByRole("link", { name: "К адвенту" })).toHaveAttribute("href", "/");
  });

  it("ошибка или нет токена: ссылка не сработала, форма не показывается, подсказка про переключатель на сайте", () => {
    for (const props of [{ view: "error", token } as const, { view: "confirm", token: null } as const]) {
      const { container, unmount } = render(<AdventUnsubscribe advent={advent} {...props} />);
      expect(screen.getByRole("heading", { level: 1, name: "Ссылка не сработала" })).toBeInTheDocument();
      expect(container.querySelector("form")).toBeNull();
      expect(screen.getByText(/Напоминания на почту/)).toBeInTheDocument();
      unmount();
    }
  });
});
