import { describe, expect, it } from "vitest";

import { renderMail } from "@/server/mailer";
import { escapeHtml, renderReminderMail, type ReminderMailVars } from "@/server/mail-reminder";

const vars = (patch: Partial<ReminderMailVars> = {}): ReminderMailVars => ({
  subject: "Дверь 5 открыта",
  preheader: "Скрытый предпросмотр",
  brandName: "Зерно",
  colors: { bg: "#1b2a3a", ink: "#ffffff", accent: "#e8743b", onAccent: "#ffffff", paper: "#ffffff", paperInk: "#1f2430" },
  dayNumber: 5,
  dayTitle: "Идеальный эспрессо",
  teaser: "Что нужно для первой чашки дня",
  buttonLabel: "Открыть дверь 5",
  link: "https://zerno.test/api/advent/reminders/open?r=1&token=abc",
  progress: { opened: 3, total: 12 },
  unsubscribeUrl: "https://zerno.test/unsubscribe?t=tok",
  unsubscribeOneClickUrl: "https://zerno.test/api/advent/unsubscribe/one-click?t=tok",
  operatorName: "ООО «Зерно»",
  ...patch
});

describe("письмо-напоминание", () => {
  it("HTML и текст содержат бренд, номер окна, teaser, кнопку, прогресс, отписку и оператора", () => {
    const mail = renderMail("reminder", vars());
    expect(mail.subject).toBe("Дверь 5 открыта");
    for (const part of ["Зерно", "№ 5", "Идеальный эспрессо", "Что нужно для первой чашки дня", "Открыть дверь 5", "Открыто 3 из 12", "Отписаться", "ООО «Зерно»", "Скрытый предпросмотр"]) {
      expect(mail.html).toContain(part);
    }
    for (const part of ["Идеальный эспрессо", "Открыть дверь 5: https://zerno.test/api/advent/reminders/open?r=1&token=abc", "Открыто 3 из 12", "Отписаться: https://zerno.test/unsubscribe?t=tok", "Оператор: ООО «Зерно»"]) {
      expect(mail.text).toContain(part);
    }
    expect(mail.html).toContain("#e8743b");
    expect(mail.html).toContain('lang="ru"');
  });

  it("тема — одна строка: перевод строки из текстов пакета не попадает в заголовок письма", () => {
    const mail = renderMail("reminder", vars({ subject: "Дверь 5\r\nBcc: evil@example.test\n\tоткрыта" }));
    expect(mail.subject).toBe("Дверь 5 Bcc: evil@example.test открыта");
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it("заголовки RFC 8058: List-Unsubscribe на HTTPS-адрес и List-Unsubscribe-Post", () => {
    const mail = renderMail("reminder", vars());
    expect(mail.headers).toEqual({
      "List-Unsubscribe": "<https://zerno.test/api/advent/unsubscribe/one-click?t=tok>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    });
  });

  it("абзацы возвращения и догоняния выводятся, реквизиты оператора — через запятую", () => {
    const mail = renderMail("reminder", vars({ comebackText: "Мы скучали.", catchUpText: "Дверь 4 ещё открыта.", operatorDetails: "ИНН 7700000000, Москва" }));
    expect(mail.html).toContain("Мы скучали.");
    expect(mail.html).toContain("Дверь 4 ещё открыта.");
    expect(mail.text).toContain("Мы скучали.");
    expect(mail.text).toContain("Оператор: ООО «Зерно», ИНН 7700000000, Москва");
    expect(renderMail("reminder", vars()).html).not.toContain("Мы скучали.");
  });

  it("тексты пакета экранируются в HTML, в тексте остаются как есть", () => {
    const evil = '<script>alert("x")</script> & \'q\'';
    const mail = renderReminderMail(vars({ brandName: evil, dayTitle: evil, teaser: evil, preheader: evil, buttonLabel: evil, operatorName: evil, comebackText: evil, catchUpText: evil, subject: evil }));
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;");
    expect(mail.text).toContain(evil);
  });

  it("цвета и ссылки: разметка в стиле и javascript: не проходят", () => {
    const mail = renderReminderMail(
      vars({
        colors: { bg: 'red;"><x', ink: "#fff", accent: "url(javascript:1)", onAccent: "#ffffff", paper: "#ffffff", paperInk: "#000000" },
        link: "javascript:alert(1)",
        unsubscribeUrl: "data:text/html,boom"
      })
    );
    expect(mail.html).not.toContain("javascript:");
    expect(mail.html).not.toContain("data:text");
    expect(mail.html).not.toContain("<x");
    expect(mail.html).toContain('href="#"');
  });

  it("полоса прогресса не выходит за 100 % и не делит на ноль", () => {
    expect(renderReminderMail(vars({ progress: { opened: 40, total: 12 } })).html).toContain("width:100%");
    expect(renderReminderMail(vars({ progress: { opened: 0, total: 0 } })).html).toContain("width:0%");
  });

  it("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
