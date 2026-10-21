type Bucket = { count: number; windowStartedAt: number };

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  reset(): void {
    this.buckets.clear();
  }

  setLimit(limit: number): void {
    this.limit = limit;
  }

  allow(key: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStartedAt >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStartedAt: now });
      return true;
    }
    if (bucket.count >= this.limit) {
      return false;
    }
    bucket.count += 1;
    return true;
  }
}

// One full game uses roughly 80 requests (rooms, tasks, answers and up to ~1 per second in the
// 30-second rush). This leaves headroom for 25 users sharing a corporate NAT while still
// bounding abuse on the single-instance MVP.
export const publicApiRateLimiter = new FixedWindowRateLimiter(3000, 60_000);

// Создание сессии пишет в БД и выдаёт новый ключ доступа, поэтому ограничено отдельно и строже:
// 60 в минуту на ключ клиента хватает целому офису за одним NAT, но не даёт заливать базу сессиями.
export const sessionCreationRateLimiter = new FixedWindowRateLimiter(60, 60_000);

// Публичные /share/* (страница и картинка) открыты без cookie и ходят в БД, а картинка ещё и грузит процессор
// (Satori/resvg). Мессенджеры и соцсети тянут страницу и картинку парой, поэтому 60 в минуту на IP хватает
// и целому офису за одним NAT, и не даёт гонять рендер в цикле. Query-параметры на ключ не влияют.
export const shareRateLimiter = new FixedWindowRateLimiter(60, 60_000);

// Адвент: создание участника пишет в БД и выдаёт ключ доступа, поэтому, как и сессии квиза, 60 в минуту на ключ клиента.
export const adventParticipantRateLimiter = new FixedWindowRateLimiter(60, 60_000);

// Запрос ссылки входа отправляет письмо: строго, по 5 в минуту и на IP, и на участника (чтобы не заливать чужую почту).
export const identityRequestIpRateLimiter = new FixedWindowRateLimiter(5, 60_000);
export const identityRequestParticipantRateLimiter = new FixedWindowRateLimiter(5, 60_000);
// И на адрес: с разных IP и участников нельзя заваливать письмами один чужой ящик. Ключ — хеш адреса, не сам адрес.
export const identityRequestEmailRateLimiter = new FixedWindowRateLimiter(5, 15 * 60_000);
// Кнопка «Прислать ссылку для входа» со страницы письма-напоминания: ещё и на доставку (одно письмо — не больше 3 ссылок за 15 минут).
export const reminderLoginDeliveryRateLimiter = new FixedWindowRateLimiter(3, 15 * 60_000);

// Проверка пароля оператора идёт через scrypt (десятки миллисекунд процессора и 32 МиБ на попытку), а /admin виден из интернета.
// 60 попыток в минуту на IP хватает оператору (страница = 2 проверки: proxy и сама страница), но не даёт перебирать пароли
// и нагружать процессор. Исчерпанный лимит отвечает как неверный пароль (401).
export const adminAuthRateLimiter = new FixedWindowRateLimiter(60, 60_000);

// Касса адвента: проверка и погашение кода. Доступ и так за паролем кассира; лимит защищает от перебора кодов с украденным
// паролем и от залипшей кнопки. 120 в минуту на точку (ключ арендатор + IP) хватает очереди из нескольких касс за одним NAT.
export const redeemRateLimiter = new FixedWindowRateLimiter(120, 60_000);
