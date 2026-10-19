import { expect, type Locator, type Page } from "@playwright/test";

/** Нажимает Tab, пока фокус не окажется на нужном элементе; падает, если за разумное число шагов не дошли. */
export async function focusByTab(page: Page, target: Locator, maxSteps = 40) {
  for (let step = 0; step <= maxSteps; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Фокус с клавиатуры не дошёл до элемента за ${maxSteps} нажатий Tab: ${target}`);
}

/**
 * Проверяет, что у элемента в фокусе есть видимый индикатор, которого нет без фокуса: стиль
 * (outline, box-shadow, граница, фон) сравнивается в фокусе и после снятия фокуса, поэтому
 * постоянная тень не засчитывается. Нативные radio/checkbox в игре скрыты (opacity: 0),
 * поэтому индикатор ищется на обёртке-label.
 */
export async function expectVisibleFocus(page: Page) {
  const indicator = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return { ok: false, reason: "фокус на body" };
    const hiddenControl =
      element instanceof HTMLInputElement &&
      ["radio", "checkbox"].includes(element.type) &&
      getComputedStyle(element).opacity === "0";
    const target = hiddenControl ? (element.closest("label") ?? element) : element;
    const read = () => {
      const style = getComputedStyle(target);
      return {
        outline: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0 ? style.outline : "none",
        boxShadow: style.boxShadow,
        borderColor: style.borderColor,
        background: style.backgroundColor
      };
    };
    // Переходы отключаются на время замера, чтобы стиль без фокуса читался сразу, а не посреди анимации.
    const freeze = document.createElement("style");
    freeze.textContent = "*, *::before, *::after { transition: none !important; }";
    document.head.append(freeze);
    const focused = read();
    element.blur();
    const plain = read();
    element.focus();
    freeze.remove();
    const changed = (Object.keys(focused) as Array<keyof typeof focused>).filter((key) => focused[key] !== plain[key]);
    const name = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40) ?? element.tagName;
    return {
      ok: changed.length > 0,
      reason: `${element.tagName} «${name}»: в фокусе ${JSON.stringify(focused)}, без фокуса ${JSON.stringify(plain)}`
    };
  });
  expect(indicator.ok, `нет видимого индикатора фокуса, отличающего его от обычного состояния: ${indicator.reason}`).toBe(true);
}
