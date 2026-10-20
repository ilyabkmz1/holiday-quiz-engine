// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SaveProgressCard } from "@/components/advent/SaveProgressCard";

import { config } from "../support/advent-ui";

afterEach(cleanup);

const consentText = config.legal.consentText;

function mount(onSubmit = vi.fn().mockResolvedValue(undefined), reason: "after-day" | "identity" = "after-day") {
  render(<SaveProgressCard copy={config.copy} consentText={consentText} reason={reason} onSubmit={onSubmit} />);
  return onSubmit;
}

const email = () => screen.getByLabelText(config.copy.saveEmail);
const consent = () => screen.getByRole("checkbox", { name: config.copy.saveConsent });
const marketing = () => screen.getByRole("checkbox", { name: config.copy.saveMarketing });
const submit = () => screen.getByRole("button", { name: config.copy.saveSubmit });

describe("SaveProgressCard", () => {
  it("показывает текст согласия из пакета и ссылку на политику; два чекбокса отдельно, рассылка не отмечена", () => {
    mount();
    expect(document.querySelector(".adv-legal")?.textContent).toContain(consentText);
    expect(screen.getByRole("link", { name: config.copy.savePolicy })).toHaveAttribute("href", "/privacy");
    expect(consent()).not.toBeChecked();
    expect(marketing()).not.toBeChecked();
    expect(consent()).toHaveAttribute("aria-required", "true");
    expect(marketing()).not.toHaveAttribute("aria-required");
  });

  it("при ответе identity_required объясняет, зачем нужен вход", () => {
    mount(undefined, "identity");
    expect(screen.getByText(config.copy.saveIdentityRequired)).toBeInTheDocument();
  });

  it("без согласия на обработку данных письмо не отправляется", async () => {
    const onSubmit = mount();
    fireEvent.change(email(), { target: { value: "guest@example.test" } });
    await act(async () => void fireEvent.click(submit()));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(config.copy.saveErrorConsent);
  });

  it("неверный email — ошибка, письмо не отправляется", async () => {
    const onSubmit = mount();
    fireEvent.change(email(), { target: { value: "guest" } });
    fireEvent.click(consent());
    await act(async () => void fireEvent.click(submit()));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(config.copy.saveErrorEmail);
    expect(email()).toHaveAttribute("aria-invalid", "true");
  });

  it("только обязательное согласие: рассылка и напоминания выключены", async () => {
    const onSubmit = mount();
    fireEvent.change(email(), { target: { value: "  guest@example.test " } });
    fireEvent.click(consent());
    await act(async () => void fireEvent.click(submit()));
    expect(onSubmit).toHaveBeenCalledWith({ email: "guest@example.test", consent: true, marketingConsent: false, reminderOptIn: false });
  });

  it("чекбокс напоминаний включает только напоминания, а не согласие на рекламную рассылку", async () => {
    const onSubmit = mount();
    fireEvent.change(email(), { target: { value: "guest@example.test" } });
    fireEvent.click(consent());
    fireEvent.click(marketing());
    await act(async () => void fireEvent.click(submit()));
    expect(onSubmit).toHaveBeenCalledWith({ email: "guest@example.test", consent: true, marketingConsent: false, reminderOptIn: true });
  });

  it("после отправки — «проверьте почту» с адресом; можно указать другой", async () => {
    mount();
    fireEvent.change(email(), { target: { value: "guest@example.test" } });
    fireEvent.click(consent());
    await act(async () => void fireEvent.click(submit()));
    expect(screen.getByRole("heading", { name: config.copy.saveSentTitle })).toBeInTheDocument();
    expect(screen.getByText("Мы отправили ссылку для входа на guest@example.test. Откройте её на этом устройстве.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: config.copy.saveChange }));
    expect(screen.getByRole("button", { name: config.copy.saveSubmit })).toBeInTheDocument();
  });

  it("ошибка отправки показывается, форма остаётся, повторная отправка возможна", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error("Слишком много запросов ссылки. Попробуйте позже.")).mockResolvedValue(undefined);
    mount(onSubmit);
    fireEvent.change(email(), { target: { value: "guest@example.test" } });
    fireEvent.click(consent());
    await act(async () => void fireEvent.click(submit()));
    expect(screen.getByRole("alert")).toHaveTextContent("Слишком много запросов ссылки");
    expect(submit()).toBeEnabled();
    await act(async () => void fireEvent.click(submit()));
    expect(screen.getByRole("heading", { name: config.copy.saveSentTitle })).toBeInTheDocument();
  });

  it("двойное нажатие не отправляет письмо дважды", async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => (resolve = done)));
    mount(onSubmit);
    fireEvent.change(email(), { target: { value: "guest@example.test" } });
    fireEvent.click(consent());
    fireEvent.click(submit());
    fireEvent.click(screen.getByRole("button", { name: config.copy.saveSending }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });
});
