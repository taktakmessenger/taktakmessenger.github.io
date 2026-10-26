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
FRONTEND_PORT="${FRONTEND_PORT:-12000}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
WEB_URL="http://127.0.0.1:${FRONTEND_PORT}/"

MONGO_CONTAINER="${MONGO_CONTAINER:-taktak-mongo}"
# En este contenedor el usuario no está en el grupo `docker`, así que hace falta
# sudo. Se detecta una vez, igual que en `dev-up.sh`.
if docker info >/dev/null 2>&1; then DOCKER="docker"; else DOCKER="sudo docker"; fi

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# La API no se busca por `SERVE_MODE`, sino por su respuesta. En `split` está en
# el 4000 y el 12000 es Vite; en `single` web y API comparten el 12000. Depender
# de la variable era frágil: un vigilante relanzado sin ella miraba el puerto
# equivocado (Vite devuelve HTML, no la API) y reiniciaba la pila en falso.
detect_health_url() {
  for url in "http://127.0.0.1:${BACKEND_PORT}/health" \
             "http://127.0.0.1:${FRONTEND_PORT}/health"; do
    if curl -fsS --max-time 3 "$url" 2>/dev/null | grep -q '"service":"TAK TAK API"'; then
      printf '%s' "$url"; return 0
    fi
  done
  printf 'http://127.0.0.1:%s/health' "$BACKEND_PORT"
}

# El puerto puede responder 200 con la base de datos caída: `/health` informa del
# estado de Mongo en el campo `db`. Vigilar solo el puerto dejaba la app colgada
# en el splash sin que nadie reiniciara nada (el 200 tapaba la avería). Aquí se
# mira `db` de verdad.
api_ok() {
  curl -fsS --max-time 5 "$(detect_health_url)" 2>/dev/null | grep -q '"db":"connected"'
}

web_ok() {
  curl -fsS -o /dev/null --max-time 5 "$WEB_URL" 2>/dev/null
}

log "Vigilante iniciado (cada ${INTERVAL}s)"

while true; do
  backend_ok=0
  frontend_ok=0
  # `api_ok` ya exige `"db":"connected"`, así que un puerto que responde con la
  # base caída cuenta como caída y dispara la recuperación (antes se escapaba).
  api_ok && backend_ok=1
  web_ok && frontend_ok=1

  if [ "$backend_ok" = "1" ] && [ "$frontend_ok" = "1" ]; then
    sleep "$INTERVAL"
    continue
  fi

  log "Caída detectada (backend=$backend_ok frontend=$frontend_ok). Relanzando la pila…"
  # Si el contenedor sigue arriba pero su puerto dejó de publicarse (el
  # `docker-proxy` murió), `dev-up.sh` lo da por bueno y no lo arregla. Un
  # reinicio del contenedor vuelve a levantar el proxy, y es barato.
  if $DOCKER ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MONGO_CONTAINER"; then
    $DOCKER restart "$MONGO_CONTAINER" >/dev/null 2>&1 || true
  fi
  bash "$ROOT/scripts/dev-up.sh" >>"${LOG_DIR:-/tmp}/taktak-watch.log" 2>&1

  backend_ok=0; frontend_ok=0
  api_ok && backend_ok=1
  web_ok && frontend_ok=1
  if [ "$backend_ok" = "1" ] && [ "$frontend_ok" = "1" ]; then
    log "Pila restaurada"
  else
    log "No se pudo restaurar; se reintentará en ${INTERVAL}s"
  fi

  sleep "$INTERVAL"
done
