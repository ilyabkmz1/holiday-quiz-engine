#!/usr/bin/env bash
# Откат приложения на предыдущую рабочую версию (образ + ревизия кода). БД НЕ откатывается.
#
# Почему БД остаётся как есть: миграции Prisma в этом проекте аддитивные (новые таблицы/колонки/индексы),
# старый код работает на более новой схеме. Данные игроков откатом не теряются. Если нужно вернуть именно
# данные — это restore.sh (потеряются все записи после дампа!), отдельное решение владельца.
#
# Если последняя выкатка остановилась до перезапуска сервисов (phase=prestart в state/deploy_phase) --
# работает прежняя версия, скрипт лишь возвращает код в дереве к ней и ничего не перезапускает.
#
# Что считается «предыдущей версией»:
#   - если последняя выкатка НЕ дошла до успеха (образ :latest != :current) — откат к :current (последней успешной);
#   - иначе — к :previous (версии до последней успешной выкатки).
# Использование: deploy/rollback.sh
set -euo pipefail

# shellcheck source=deploy/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  local app_img="${COMPOSE_PROJECT_NAME}-app" mig_img="${COMPOSE_PROJECT_NAME}-migrate"
  local latest cur prev target_tag target_rev from_rev
  require_docker
  validate_env
  mkdir -p "$STATE_DIR"

  # Если последняя выкатка остановилась ДО перезапуска сервисов (ошибка сборки, дампа, миграции), работает
  # прежняя версия: откатывать нечего, нужно лишь вернуть код в дереве к ревизии, которая работает.
  if [ "$(cat "$STATE_DIR/deploy_phase" 2>/dev/null || true)" = prestart ]; then
    local run_rev
    run_rev="$(cat "$STATE_DIR/current_rev" 2>/dev/null || echo "")"
    info "Последняя выкатка остановилась до перезапуска сервисов: работает прежняя версия, откат не требуется."
    if [ -n "$run_rev" ] && [ "${QUIZ_SKIP_GIT:-0}" != 1 ]; then
      cd "$REPO_DIR"
      [ -z "$(git status --porcelain --untracked-files=no)" ] || die "В $REPO_DIR есть локальные изменения; остановлено."
      git checkout --detach --quiet "$run_rev" || die "Не удаётся переключиться на $run_rev."
      info "Код в $REPO_DIR возвращён к работающей ревизии ${run_rev:0:7}."
    fi
    printf '%s\n' ok > "$STATE_DIR/deploy_phase"
    ok "Ничего не изменено в работающих сервисах. Исправьте причину сбоя и повторите deploy/deploy.sh."
    return 0
  fi

  latest="$(image_id "$app_img:latest")"; cur="$(image_id "$app_img:current")"; prev="$(image_id "$app_img:previous")"
  from_rev="$(cd "$REPO_DIR" && git rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ -n "$cur" ] && [ "$latest" != "$cur" ]; then
    target_tag=current; target_rev="$(cat "$STATE_DIR/current_rev" 2>/dev/null || echo "")"
    info "Последняя выкатка не завершилась успехом: возвращаемся к последней успешной версии."
  else
    [ -n "$prev" ] || die "Нет сохранённой предыдущей версии (образ $app_img:previous). Откатиться можно пересборкой: deploy/deploy.sh <хеш_предыдущей_ревизии> (хеш: git log --oneline)."
    target_tag=previous; target_rev="$(cat "$STATE_DIR/previous_rev" 2>/dev/null || echo "")"
  fi

  step "Откат на образ :$target_tag${target_rev:+ (ревизия ${target_rev:0:7})}"
  if [ -n "$target_rev" ] && [ "${QUIZ_SKIP_GIT:-0}" != 1 ]; then
    cd "$REPO_DIR"
    [ -z "$(git status --porcelain --untracked-files=no)" ] || die "В $REPO_DIR есть локальные изменения; откат остановлен."
    git checkout --detach --quiet "$target_rev" || die "Не удаётся переключиться на $target_rev (git fetch выполнен?)."
  fi

  # Запоминаем id заранее: метки ниже переписываются.
  local t_app t_mig bad_app bad_mig
  t_app="$(image_id "$app_img:$target_tag")"; t_mig="$(image_id "$mig_img:$target_tag")"
  bad_app="$(image_id "$app_img:latest")"; bad_mig="$(image_id "$mig_img:latest")"
  [ -n "$t_app" ] || die "Образ $app_img:$target_tag отсутствует. Пересоберите нужную ревизию: deploy/deploy.sh <хеш>."
  docker tag "$t_app" "$app_img:latest"
  [ -z "$t_mig" ] || docker tag "$t_mig" "$mig_img:latest"
  # Откатываемая («плохая») версия остаётся в :previous — вернуться назад можно повторным запуском.
  if [ "$bad_app" != "$t_app" ]; then
    docker tag "$bad_app" "$app_img:previous"
    [ -z "$bad_mig" ] || docker tag "$bad_mig" "$mig_img:previous"
  fi

  step "Перезапуск сервисов без пересборки и без миграций"
  local services
  services="$(dc config --services | grep -vx migrate | tr '\n' ' ')"
  # shellcheck disable=SC2086
  dc up -d --no-build --no-deps $services
  wait_healthy app 120 || { dc logs --no-color --tail 40 app >&2 || true; die "После отката app не стал healthy. Смотрите deploy/logs.sh app."; }

  docker tag "$app_img:latest" "$app_img:current"
  [ -z "$(image_id "$mig_img:latest")" ] || docker tag "$mig_img:latest" "$mig_img:current"
  printf '%s\n' "$from_rev" > "$STATE_DIR/previous_rev"
  [ -z "$target_rev" ] || printf '%s\n' "$target_rev" > "$STATE_DIR/current_rev"

  printf '%s\n' ok > "$STATE_DIR/deploy_phase"
  ok "Откат выполнен. Проверка: deploy/smoke.sh"
  warn "БД не откатывалась (миграции аддитивные). Возврат к дампу — только deploy/restore.sh --full и только по решению владельца."
}
main
