import { findTenant, tenantCore } from "@/server/tenants";

/**
 * Имя бренда, пригодное для `WWW-Authenticate`: значение заголовка — ByteString, кириллица в нём роняет
 * `new Headers()` (TypeError → 500), а `"`, `\` и переводы строк ломают quoted-string. Оставляем печатный ASCII.
 */
function realmName(brandName: string): string | null {
  const ascii = brandName.replace(/[^\x20-\x7E]|["\\]/g, " ").replace(/\s+/g, " ").trim();
  return /[A-Za-z0-9]/.test(ascii) ? ascii : null;
}

/**
 * Имя области для Basic auth: бренд арендатора по Host. Если арендатор не определился (чужой Host, ошибка конфигурации)
 * или имя бренда не латинское, имя нейтральное: realm не должен ронять proxy и не должен раскрывать имена чужих клиентов.
 */
export function authRealm(host: string | null, suffix = ""): string {
  let name = "Quiz";
  try {
    const tenant = findTenant(host);
    const brand = tenant ? realmName(tenantCore(tenant).brand.name) : null;
    if (brand) name = `${brand} Quiz`;
  } catch {
    // Некорректный TENANT всплывёт в самом приложении; здесь важен только заголовок.
  }
  return suffix ? `${name} ${suffix}` : name;
}
