/** Нормализованный email: ключ уникальности заявки квиза и участника адвента. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
