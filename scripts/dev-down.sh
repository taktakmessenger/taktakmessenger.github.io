#!/usr/bin/env bash
# Para la pila de desarrollo de TAK TAK (frontend, backend y MongoDB).
# Docker se deja en marcha a propósito: pararlo en un contenedor puede requerir
# privilegios y no aporta nada.
#
# Uso:  bash scripts/dev-down.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-12000}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
MONGO_CONTAINER="${MONGO_CONTAINER:-taktak-mongo}"
RUN_DIR="${RUN_DIR:-$ROOT/.run}"

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }

# En este contenedor el usuario no pertenece al grupo `docker`; se necesita sudo.
if docker info >/dev/null 2>&1; then
  DOCKER="docker"
else
  DOCKER="sudo docker"
fi

# Detiene por pidfile y, como respaldo, por patrón de proceso. `ss`/`lsof` no
# están instalados en este contenedor, así que no se usan.
#
# Se matan los dos conjuntos, no uno u otro: los procesos se lanzan con `setsid`,
# así que el PID del pidfile puede ser el de la subshell que los arrancó y el
# `node` real quedar con otro PID. Quedarse solo con el pidfile dejaba vivo el
# servidor y el `dev-down.sh` no apagaba nada.
stop_service() { # pidfile, patrón pgrep, etiqueta
  local pidfile="$1" pattern="$2" label="$3" pids=""

  if [ -f "$pidfile" ]; then
    local pid; pid="$(cat "$pidfile")"
    kill -0 "$pid" 2>/dev/null && pids="$pid"
    rm -f "$pidfile"
  fi

  pids="$pids $(pgrep -f "$pattern" 2>/dev/null | tr '\n' ' ')"

  if [ -z "$(echo "$pids" | tr -d '[:space:]')" ]; then
    ok "$label no estaba en marcha"
    return 0
  fi

  # shellcheck disable=SC2086
  kill $pids 2>/dev/null
  for _ in $(seq 1 10); do
    local still=""
    for p in $pids; do kill -0 "$p" 2>/dev/null && still="$still $p"; done
    [ -z "$(echo "$still" | tr -d '[:space:]')" ] && break
    sleep 1
  done
  # shellcheck disable=SC2086
  for p in $pids; do kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null; done
  ok "$label detenido (pid:$pids)"
}

say "Parando el vigilante"
# Primero el vigilante: si sigue vivo, ve la pila caída y la vuelve a levantar,
# así que un `dev-down.sh` no llegaría a apagar nada.
if pgrep -f "scripts/dev-watch.sh" >/dev/null 2>&1; then
  pkill -f "scripts/dev-watch.sh" 2>/dev/null
  sleep 1
  pgrep -f "scripts/dev-watch.sh" >/dev/null 2>&1 \
    && ok "el vigilante no se detuvo" || ok "vigilante detenido"
else
  ok "no estaba en marcha"
fi

say "Parando el frontend (:$FRONTEND_PORT)"
stop_service "$RUN_DIR/frontend.pid" "vite --host" "frontend"

say "Parando el backend (:$BACKEND_PORT)"
stop_service "$RUN_DIR/backend.pid" "node src/index.js" "backend"

say "Parando MongoDB ($MONGO_CONTAINER)"
if $DOCKER ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MONGO_CONTAINER"; then
  $DOCKER stop "$MONGO_CONTAINER" >/dev/null && ok "contenedor detenido"
else
  ok "no estaba en marcha"
fi

printf '\n\033[1;32m✅ Pila detenida\033[0m\n'
