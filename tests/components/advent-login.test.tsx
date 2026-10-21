// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdventLogin, LOGIN_FORM_ACTION } from "@/components/advent/AdventLogin";

import { adventConfig } from "../support/advent";

afterEach(cleanup);

describe("AdventLogin (промежуточная страница входа)", () => {
  const advent = adventConfig();

  it("с токеном: кнопка «Войти» отправляет POST с токеном, без JavaScript", () => {
    const { container } = render(<AdventLogin advent={advent} token={"t".repeat(43)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(advent.title);
    const button = screen.getByRole("button", { name: "Войти" });
    const form = button.closest("form")!;
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", LOGIN_FORM_ACTION);
    expect(container.querySelector('input[type="hidden"][name="token"]')).toHaveValue("t".repeat(43));
    expect(screen.getByText(advent.brand.topNote)).toBeInTheDocument();
  });

  it("вход из письма-напоминания: форма несёт идентификатор доставки, обычная — нет", () => {
    const delivery = "11111111-2222-4333-8444-555555555555";
    const { container, rerender } = render(<AdventLogin advent={advent} token={"t".repeat(43)} delivery={delivery} />);
    expect(container.querySelector('input[type="hidden"][name="r"]')).toHaveValue(delivery);
    rerender(<AdventLogin advent={advent} token={"t".repeat(43)} />);
    expect(container.querySelector('input[type="hidden"][name="r"]')).toBeNull();
  });

  it("без токена: «ссылка не сработала» и ссылка на главную, формы нет", () => {
    render(<AdventLogin advent={advent} token={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Ссылка не сработала" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Войти" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "На главную" })).toHaveAttribute("href", "/");
  });
});
