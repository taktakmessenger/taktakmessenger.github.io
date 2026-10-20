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
INTERVAL="${WATCH_INTERVAL:-30}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT:-4000}/health"
FRONTEND_URL="http://127.0.0.1:${FRONTEND_PORT:-12000}/"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

log "Vigilante iniciado (cada ${INTERVAL}s)"

while true; do
  backend_ok=0
  frontend_ok=0
  curl -fsS -o /dev/null --max-time 5 "$BACKEND_URL" 2>/dev/null && backend_ok=1
  curl -fsS -o /dev/null --max-time 5 "$FRONTEND_URL" 2>/dev/null && frontend_ok=1

  if [ "$backend_ok" = "1" ] && [ "$frontend_ok" = "1" ]; then
    sleep "$INTERVAL"
    continue
  fi

  log "Caída detectada (backend=$backend_ok frontend=$frontend_ok). Relanzando la pila…"
  bash "$ROOT/scripts/dev-up.sh" >>"${LOG_DIR:-/tmp}/taktak-watch.log" 2>&1

  if curl -fsS -o /dev/null --max-time 5 "$BACKEND_URL" 2>/dev/null &&
     curl -fsS -o /dev/null --max-time 5 "$FRONTEND_URL" 2>/dev/null; then
    log "Pila restaurada"
  else
    log "No se pudo restaurar; se reintentará en ${INTERVAL}s"
  fi

  sleep "$INTERVAL"
done
