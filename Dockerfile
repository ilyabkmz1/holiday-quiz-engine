FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Боевой образ только с нужными пакетами (например, QUIZ_PACKS=demo-office): демо и чужие клиенты в него не попадают.
# Пусто — все пакеты из tenants/ (общий сервер). Манифест переписывается на копии внутри сборки.
ARG QUIZ_PACKS=""
RUN if [ -n "$QUIZ_PACKS" ]; then node scripts/select-packs.mjs "$QUIZ_PACKS"; fi
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm run build

FROM deps AS migrate
WORKDIR /app
COPY . .
# Seed засевает кампании из tenants/: тот же набор пакетов, что и в app.
ARG QUIZ_PACKS=""
RUN if [ -n "$QUIZ_PACKS" ]; then node scripts/select-packs.mjs "$QUIZ_PACKS"; fi
# seed импортирует сгенерированный клиент. prisma.config.ts требует DATABASE_URL уже при
# загрузке конфига, поэтому для генерации нужна заглушка; реальный адрес задаётся при запуске.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npx prisma generate
CMD ["sh", "-c", "npx prisma migrate deploy && npm run db:seed"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# Ревизия сборки (git sha) для GET /api/health: docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD).
# ARG стоит после COPY: смена ревизии не сбрасывает кеш слоёв с кодом и зависимостями.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
