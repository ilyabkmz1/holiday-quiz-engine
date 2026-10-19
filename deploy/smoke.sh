#!/usr/bin/env bash
# Дымовая проверка работающего стека (режим определяется по /opt/quiz/.env):
#   health, ready, закрытость/открытость сайта, админский endpoint, создание игровой сессии с правильным Origin.
# Использование: deploy/smoke.sh [--local] [--no-session]
#   --local       ходить на 127.0.0.1 (тот же домен/TLS, но без DNS и hairpin NAT)
#   --no-session  не создавать игровую сессию (в боевом окне кампании она попадёт в метрики)
# Код возврата 0 — всё в порядке.
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

LOCAL=(); CREATE_SESSION=1
for arg in "$@"; do
  case "$arg" in
    --local) LOCAL=(--resolve-local) ;;
    --no-session) CREATE_SESSION=0 ;;
    *) die "Неизвестная опция $arg" ;;
  esac
done

[ -f "$ENV_FILE" ] || die "Нет $ENV_FILE."
BASE="$(env_get APP_URL)"; MODE="$(mode_name)"
SU="$(env_get STAGING_USERNAME)"; SP="$(env_get STAGING_PASSWORD)"
AU="$(env_get ADMIN_USERNAME)"; AP="$(env_get ADMIN_PASSWORD)"
FAILED=0

check() { # check "описание" ожидаемый_код фактический_код
  if [ "$2" = "$3" ]; then ok "$1: $3"; else warn "$1: получено $3, ожидалось $2"; FAILED=1; fi
}

step "Smoke-проверка $BASE (режим: $MODE)"

check "GET /api/health (без пароля)" 200 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} "$BASE/api/health")"
grep -q '"ok"' "$VCURL_BODY" || { warn "тело /api/health не содержит ok"; FAILED=1; }

if [ "$MODE" = staging ]; then
  check "GET / без пароля закрыт" 401 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} "$BASE/")"
  check "GET /api/ready без пароля закрыт" 401 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} "$BASE/api/ready")"
  check "GET / с staging-паролем" 200 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} --auth "$SU" "$SP" "$BASE/")"
  check "GET /api/ready с staging-паролем" 200 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} --auth "$SU" "$SP" "$BASE/api/ready")"
  check "GET /api/admin/metrics без ADMIN-пароля" 401 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} "$BASE/api/admin/metrics")"
  check "GET /api/admin/metrics с ADMIN-паролем" 200 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} --auth "$AU" "$AP" "$BASE/api/admin/metrics")"
else
  check "GET / (сайт открыт без пароля)" 200 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} "$BASE/")"
  check "GET /api/ready" 200 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} "$BASE/api/ready")"
  check "GET /api/admin/metrics без пароля" 401 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} "$BASE/api/admin/metrics")"
  check "GET /api/admin/metrics с ADMIN-паролем" 200 "$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} --auth "$AU" "$AP" "$BASE/api/admin/metrics")"
fi

if [ "$CREATE_SESSION" = 1 ]; then
  # Origin обязан совпадать с APP_URL, иначе API ответит 403 «Недопустимый источник».
  ORIGIN="$(printf '%s' "$BASE" | sed -E 's#^(https?://[^/]+).*#\1#')"
  if [ "$MODE" = staging ]; then
    CODE="$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} --auth "$SU" "$SP" "$BASE/api/sessions" -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{}')"
    check "POST /api/sessions (игра создаёт сессию)" 200 "$CODE"
    grep -q '"sessionId"' "$VCURL_BODY" || { warn "в ответе нет sessionId"; FAILED=1; }
  else
    CODE="$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} "$BASE/api/sessions" -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d '{}')"
    if [ "$CODE" = 200 ]; then
      ok "POST /api/sessions: 200 (кампания открыта, сессия создана и попадёт в метрики)"
    elif [ "$CODE" = 403 ] && grep -q 'закрыт' "$VCURL_BODY"; then
      ok "POST /api/sessions: 403 «Квиз пока закрыт» (ожидаемо вне 20.12–31.12)"
    else
      warn "POST /api/sessions: получено $CODE, ожидалось 200 или 403 «закрыт»"; FAILED=1
    fi
  fi
  WRONG="$(vcurl ${LOCAL[@]+"${LOCAL[@]}"} ${SU:+--auth "$SU" "$SP"} "$BASE/api/sessions" -X POST -H 'Origin: https://evil.invalid' -H 'Content-Type: application/json' -d '{}')"
  check "POST /api/sessions с чужим Origin отклонён" 403 "$WRONG"
fi

if [ "$FAILED" = 0 ]; then
  printf '\n%s[SMOKE ПРОЙДЕН]%s\n' "$C_GREEN" "$C_OFF"
else
  printf '\n%s[SMOKE НЕ ПРОЙДЕН]%s см. deploy/README.md, «Типовые проблемы»; логи: deploy/logs.sh\n' "$C_RED" "$C_OFF" >&2
  exit 1
fi
