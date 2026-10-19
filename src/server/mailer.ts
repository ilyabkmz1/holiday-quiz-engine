import nodemailer from "nodemailer";

import { getRuntimeEnv } from "@/server/env";

/** Переменные шаблонов писем. Тексты и бренд берутся из пакета арендатора и передаются снаружи. */
export type MailVars = {
  /** Подтверждение заявки на приз квиза (ссылка действует 24 часа). */
  verify: { link: string; subject: string };
  /** Вход в адвент по одноразовой ссылке. */
  login: { link: string; subject: string; brandName: string; ttlMinutes: number };
};

export type MailTemplate = keyof MailVars;

export type RenderedMail = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const renderers: { [T in MailTemplate]: (vars: MailVars[T]) => RenderedMail } = {
  verify: ({ link, subject }) => ({
    subject,
    text: `Подтвердите заявку на приз: ${link}\n\nСсылка действует 24 часа.`,
    html: `<p>Подтвердите заявку на приз:</p><p><a href="${link}">Подтвердить email</a></p><p>Ссылка действует 24 часа.</p>`
  }),
  login: ({ link, subject, brandName, ttlMinutes }) => ({
    subject,
    text: `Войти в «${brandName}»: ${link}\n\nСсылка действует ${ttlMinutes} минут и срабатывает один раз. Если вы не запрашивали вход, просто проигнорируйте письмо.`,
    html:
      `<p>Войти в «${escapeHtml(brandName)}»:</p><p><a href="${escapeHtml(link)}">Открыть адвент</a></p>` +
      `<p>Ссылка действует ${ttlMinutes} минут и срабатывает один раз. Если вы не запрашивали вход, просто проигнорируйте письмо.</p>`
  })
};

/** Собранное письмо шаблона; вынесено для тестов, адрес и ссылка в логи не попадают. */
export function renderMail<T extends MailTemplate>(template: T, vars: MailVars[T]): RenderedMail {
  return renderers[template](vars);
}

/** Отправляет письмо по шаблону через SMTP из окружения. */
export async function sendMail<T extends MailTemplate>(template: T, to: string, vars: MailVars[T]): Promise<void> {
  const env = getRuntimeEnv();
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER && env.SMTP_PASSWORD ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {})
  });
  const mail = renderMail(template, vars);
  await transport.sendMail({ from: env.SMTP_FROM, to, subject: mail.subject, text: mail.text, html: mail.html });
}

/** Письмо с подтверждением заявки квиза; обёртка над `sendMail("verify", …)`, поведение прежнее. */
export async function sendVerificationEmail(email: string, link: string, subject: string): Promise<void> {
  await sendMail("verify", email, { link, subject });
}
