#!/usr/bin/env bash
# Удаление персональных данных (призовых заявок), созданных РАНЬШЕ явно указанной границы. Необратимо.
#   deploy/cleanup-pii.sh --yes ГРАНИЦА [--allow-late]
# ГРАНИЦА обязательна (ISO с часовым поясом, например 2027-01-03T00:00:00+03:00): значения по умолчанию нет,
# чтобы случайный запуск не стёр заявки действующей кампании. Скрипт отказывается работать, если:
#   - граница позже текущего момента (иначе удалятся и свежие заявки);
#   - граница позже 2027-01-03T00:00:00+03:00 (кампания идёт до 02.01) -- без отдельного подтверждения
#     --allow-late и ввода слова УДАЛИТЬ. Это защита от опечатки в году/месяце.
# Перед удалением автоматически делается дамп. Запускает `npm run cleanup:pii` в одноразовом контейнере migrate.
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CAMPAIGN_END='2027-01-03T00:00:00+03:00'
USAGE="Использование: deploy/cleanup-pii.sh --yes ГРАНИЦА [--allow-late]   (пример границы: 2027-01-03T00:00:00+03:00)"
YES=0; LATE=0; CUTOFF=""
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --allow-late) LATE=1 ;;
    -*) die "Неизвестная опция $arg. $USAGE" ;;
    *) [ -z "$CUTOFF" ] || die "Граница указана дважды. $USAGE"; CUTOFF="$arg" ;;
  esac
done
[ "$YES" = 1 ] || die "Операция необратима: нужен --yes. $USAGE"
[ -n "$CUTOFF" ] || die "Не указана граница. Значения по умолчанию нет. $USAGE"
[[ "$CUTOFF" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?(Z|[+-][0-9]{2}:[0-9]{2})$ ]] \
  || die "Граница '$CUTOFF' должна быть датой ISO с часовым поясом, например 2027-01-03T00:00:00+03:00."
require_docker
validate_env

dc up -d db backup >/dev/null
wait_healthy db 90 || die "БД не healthy."

# Сравнение делает PostgreSQL: он же проверяет, что дата разбирается.
# psql подставляет :'var' только из stdin/файла, не из -c.
FLAGS="$(printf '%s\n' "SELECT (:'cutoff'::timestamptz > now())::int, (:'cutoff'::timestamptz > :'end'::timestamptz)::int;" \
  | dc exec -T db psql -X -At -U quiz -d quiz -v ON_ERROR_STOP=1 -v cutoff="$CUTOFF" -v end="$CAMPAIGN_END" -f - | tr -d '\r')" \
  || die "PostgreSQL не разобрал границу '$CUTOFF'."
IN_FUTURE="${FLAGS%%|*}"; AFTER_END="${FLAGS##*|}"
[ "$IN_FUTURE" = 0 ] || die "Граница $CUTOFF позже текущего момента: удалятся и свежие заявки. Укажите прошедшую дату."
if [ "$AFTER_END" = 1 ]; then
  [ "$LATE" = 1 ] || die "Граница $CUTOFF позже окончания кампании ($CAMPAIGN_END). Если это не опечатка, повторите с --allow-late."
  warn "Граница позже окончания кампании: будут удалены ВСЕ заявки кампании, созданные до $CUTOFF."
  printf 'Для продолжения введите слово УДАЛИТЬ: '
  read -r answer
  [ "$answer" = "УДАЛИТЬ" ] || die "Отменено."
fi

step "Дамп перед удалением"
dc exec -T backup /bin/sh /scripts/backup.sh once

step "Удаляем заявки, созданные до $CUTOFF"
dc run --rm --no-deps -T \
  -e CONFIRM_PII_DELETION=DELETE_QUIZ_PII \
  -e "PII_CREATED_BEFORE=$CUTOFF" \
  migrate npm run cleanup:pii
ok "Готово. В выводе выше pii_cleanup_completed показывает число удалённых заявок."
