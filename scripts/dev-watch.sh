#!/usr/bin/env bash
# Vigilante: comprueba cada N segundos que la pila de TAK TAK siga viva y, si
# no lo está, la vuelve a levantar con scripts/dev-up.sh.
#
# Pensado para el contenedor de desarrollo, donde el entorno se reinicia y se
# lleva por delante Docker, MongoDB y los servidores (síntoma: 502 en el enlace).
#
# Uso:  setsid bash scripts/dev-watch.sh > /tmp/taktak-watch.log 2>&1 < /dev/null &
# Para: pkill -f dev-watch.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL="${WATCH_INTERVAL:-15}"
SERVE_MODE="${SERVE_MODE:-single}"
FRONTEND_PORT="${FRONTEND_PORT:-12000}"
# En modo `single` la web y la API son el mismo proceso, así que basta con
# comprobar ese puerto: si responde la API, la web también está. En `split` hay
# dos procesos y hay que vigilar los dos.
SINGLE_URL="http://127.0.0.1:${FRONTEND_PORT}/api/gifts"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT:-4000}/health"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT}/"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

log "Vigilante iniciado (modo ${SERVE_MODE}, cada ${INTERVAL}s)"

while true; do
  backend_ok=0
  frontend_ok=0
  if [ "$SERVE_MODE" = "single" ]; then
    curl -fsS -o /dev/null --max-time 5 "$SINGLE_URL" 2>/dev/null && backend_ok=1 && frontend_ok=1
  else
    curl -fsS -o /dev/null --max-time 5 "$BACKEND_URL" 2>/dev/null && backend_ok=1
    curl -fsS -o /dev/null --max-time 5 "$FRONTEND_URL" 2>/dev/null && frontend_ok=1
  fi

  if [ "$backend_ok" = "1" ] && [ "$frontend_ok" = "1" ]; then
    sleep "$INTERVAL"
    continue
  fi

  log "Caída detectada (backend=$backend_ok frontend=$frontend_ok). Relanzando la pila…"
  bash "$ROOT/scripts/dev-up.sh" >>"${LOG_DIR:-/tmp}/taktak-watch.log" 2>&1

  if [ "$SERVE_MODE" = "single" ]; then
    curl -fsS -o /dev/null --max-time 5 "$SINGLE_URL" 2>/dev/null && backend_ok=1 && frontend_ok=1
  else
    backend_ok=0; frontend_ok=0
    curl -fsS -o /dev/null --max-time 5 "$BACKEND_URL" 2>/dev/null && backend_ok=1
    curl -fsS -o /dev/null --max-time 5 "$FRONTEND_URL" 2>/dev/null && frontend_ok=1
  fi
  if [ "$backend_ok" = "1" ] && [ "$frontend_ok" = "1" ]; then
    log "Pila restaurada"
  else
    log "No se pudo restaurar; se reintentará en ${INTERVAL}s"
  fi

  sleep "$INTERVAL"
done
