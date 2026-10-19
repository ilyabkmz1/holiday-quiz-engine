/**
 * Маска email для интерфейса оператора: первая буква локальной части и домен, остальное скрыто
 * (`a***@domain.ru`). Полный адрес оператор получает только в CSV.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const [first] = Array.from(email.slice(0, at));
  const domain = email.slice(at + 1);
  return domain ? `${first}***@${domain}` : `${first}***`;
}
