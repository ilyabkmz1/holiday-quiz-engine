import { adventPackSchema, packSchema, type AdventPack, type TenantPack } from "@/config/pack";
import type { CampaignCore } from "@/config/schema";
import { DomainError } from "@/domain/errors";
import { packs as bundledPacks } from "@tenants/index";
import { loadWorld } from "@/worlds/registry";
import { roomBindingReport } from "@/worlds/world";

/** Арендатор-квиз. Всё, что было до адвента (сервисы квиза, страницы, админка), работает только с ним. */
export type Tenant = TenantPack;
/** Арендатор-адвент (`experience: "advent"`). */
export type AdventTenant = AdventPack;
export type AnyTenant = Tenant | AdventTenant;

export function isAdventTenant(tenant: AnyTenant): tenant is AdventTenant {
  return tenant.experience === "advent";
}

/** Общая часть кампании арендатора: бренд, юридические тексты, slug — то, что нужно и квизу, и адвенту. */
export function tenantCore(tenant: AnyTenant): CampaignCore {
  return isAdventTenant(tenant) ? tenant.advent : tenant.campaign;
}

/** Slug кампании: по нему разделены данные в БД. */
export function campaignSlugOf(tenant: AnyTenant): string {
  return tenantCore(tenant).slug;
}

type TenantEnv = {
  /** Однопользовательский режим: всегда этот арендатор, Host не смотрим. */
  TENANT?: string;
  /** Общий домен: `<slug>.<TENANT_BASE_DOMAIN>` открывает пакет с таким slug. */
  TENANT_BASE_DOMAIN?: string;
  NODE_ENV?: string;
};

/** Проверяет пакеты и уникальность slug, хостов и slug кампании (по нему разделены данные в БД). Принимает квизы и адвенты. */
export function loadTenants(raw: unknown[] = bundledPacks): AnyTenant[] {
  // Схема выбирается по experience; ошибки квиза остаются прежними, а не «ни один вариант не подошёл».
  const tenants: AnyTenant[] = raw.map((item) =>
    typeof item === "object" && item !== null && (item as { experience?: unknown }).experience === "advent"
      ? adventPackSchema.parse(item)
      : packSchema.parse(item)
  );
  const seen = (values: string[], what: string) => {
    const duplicate = values.find((value, index) => values.indexOf(value) !== index);
    if (duplicate) throw new Error(`Пакеты арендаторов: повтор ${what} «${duplicate}»`);
  };
  seen(tenants.map((tenant) => tenant.tenant), "tenant");
  seen(tenants.map(campaignSlugOf), "campaign.slug");
  seen(tenants.flatMap((tenant) => tenant.hosts), "host");
  // Мир и привязка зон к его точкам проверяются при старте, а не только в `quiz:check`: пакет, собранный в обход CLI, не стартует с битой привязкой.
  for (const tenant of tenants) {
    // У адвента нет мира квиза и комнат: его пакет проверяет своя схема.
    if (isAdventTenant(tenant)) continue;
    const world = loadWorld(tenant.worldId);
    const { errors } = roomBindingReport(world, tenant.campaign.rooms, tenant.campaign.mode);
    if (errors.length > 0) throw new Error(`Пакет «${tenant.tenant}»: ${errors.join("; ")}`);
  }
  return tenants;
}

let cache: AnyTenant[] | null = null;

export function getTenants(): AnyTenant[] {
  cache ??= loadTenants();
  return cache;
}

/** Только для тестов реестра. */
export function overrideTenants(next: AnyTenant[] | null): void {
  cache = next;
}

export function getTenant(slug: string): AnyTenant {
  const found = getTenants().find((tenant) => tenant.tenant === slug);
  if (!found) throw new Error(`Неизвестный арендатор: ${slug}`);
  return found;
}

function envOf(): TenantEnv {
  return {
    TENANT: process.env.TENANT || undefined,
    TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN || undefined,
    NODE_ENV: process.env.NODE_ENV
  };
}

function hostname(host: string): string {
  return host.trim().toLowerCase();
}

/**
 * Арендатор для запроса. Порядок: `TENANT` из окружения → точное совпадение Host → поддомен общего домена →
 * запасной вариант. Запасной вариант (первый пакет) допустим вне production и когда пакет единственный:
 * в production при нескольких пакетах чужой Host не должен показывать случайный квиз — вернётся `null`.
 */
export function findTenant(host: string | null, env: TenantEnv = envOf(), tenants: AnyTenant[] = getTenants()): AnyTenant | null {
  if (env.TENANT) {
    const forced = tenants.find((tenant) => tenant.tenant === env.TENANT);
    if (!forced) throw new Error(`TENANT=${env.TENANT}: такого пакета нет среди ${tenants.map((t) => t.tenant).join(", ")}`);
    return forced;
  }
  const byHost = host ? tenantForHost(host, env, tenants) : null;
  if (byHost) return byHost;
  if (tenants.length === 1 || env.NODE_ENV !== "production") return tenants[0] ?? null;
  return null;
}

/** Арендатор, которому принадлежит Host: точное совпадение с `hosts` пакета или `<slug>.<TENANT_BASE_DOMAIN>`. Без запасного варианта. */
export function tenantForHost(host: string, env: TenantEnv = envOf(), tenants: AnyTenant[] = getTenants()): AnyTenant | null {
  const normalized = hostname(host);
  const exact = tenants.find((tenant) => tenant.hosts.includes(normalized));
  if (exact) return exact;
  const base = env.TENANT_BASE_DOMAIN?.toLowerCase();
  const bare = normalized.split(":")[0];
  if (base && bare.endsWith(`.${base}`)) {
    const slug = bare.slice(0, -(base.length + 1));
    return tenants.find((tenant) => tenant.tenant === slug) ?? null;
  }
  return null;
}

/** Арендатор для запроса или `not_found`. */
export function resolveTenant(host: string | null): AnyTenant {
  const tenant = findTenant(host);
  if (!tenant) throw new DomainError("not_found", "Квиз по этому адресу не найден.");
  return tenant;
}

type HeaderReader = { get(name: string): string | null };

/** Арендатор-квиз для запроса. Для адвент-арендатора — `not_found`: квизовые страницы и маршруты на нём не существуют. */
export function tenantFromHeaders(headers: HeaderReader): Tenant {
  const tenant = resolveTenant(headers.get("host"));
  if (isAdventTenant(tenant)) throw new DomainError("not_found", "Квиз по этому адресу не найден.");
  return tenant;
}

/** Арендатор-адвент для запроса. Для квиза — `not_found`. */
export function adventTenantFromHeaders(headers: HeaderReader): AdventTenant {
  const tenant = resolveTenant(headers.get("host"));
  if (!isAdventTenant(tenant)) throw new DomainError("not_found", "Адвент по этому адресу не найден.");
  return tenant;
}

/** Арендатор любого вида: для общих мест (тема, метаданные, главная страница). */
export function anyTenantFromHeaders(headers: HeaderReader): AnyTenant {
  return resolveTenant(headers.get("host"));
}

/**
 * Проверка при старте: в production с несколькими пакетами нужно явно сказать, какой показывать (`TENANT`),
 * либо задать общий домен (`TENANT_BASE_DOMAIN`). Хосты в самих пакетах этого не заменяют: у демо-пакетов они
 * вида `*.localhost`, и такой пакет в образе не должен «включать» многоарендный режим. Иначе выкатка падает по healthcheck, а не отдаёт 404 игрокам.
 */
export function assertTenantsConfigured(env: TenantEnv = envOf(), tenants: AnyTenant[] = getTenants()): void {
  if (env.TENANT) {
    findTenant(null, env, tenants);
    return;
  }
  if (env.NODE_ENV === "production" && tenants.length > 1 && !env.TENANT_BASE_DOMAIN) {
    throw new Error(
      `В образе несколько пакетов арендаторов (${tenants.map((t) => t.tenant).join(", ")}): задайте TENANT=<slug> для одного клиента ` +
        "или TENANT_BASE_DOMAIN для общего сервера. Для боевого образа клиента соберите его только с нужным пакетом (QUIZ_PACKS)."
    );
  }
}

/** Пакеты, чьи юридические тексты проверяются при запуске: один выбранный `TENANT` или все. */
export function activeTenants(env: TenantEnv = envOf(), tenants: AnyTenant[] = getTenants()): AnyTenant[] {
  return env.TENANT ? tenants.filter((tenant) => tenant.tenant === env.TENANT) : tenants;
}

/** Публичный базовый адрес арендатора: первый его хост, иначе поддомен общего домена (без `TENANT`), иначе `APP_URL`. */
export function tenantBaseUrl(tenant: AnyTenant, appUrl: string, env: TenantEnv = envOf()): string {
  const host = tenant.hosts[0];
  if (host) return `${new URL(appUrl).protocol}//${host}`;
  if (env.TENANT_BASE_DOMAIN && !env.TENANT) {
    const url = new URL(appUrl);
    url.hostname = `${tenant.tenant}.${env.TENANT_BASE_DOMAIN.toLowerCase()}`;
    return url.origin;
  }
  return appUrl;
}
