#!/usr/bin/env bash
# Levanta la pila completa de TAK TAK para desarrollo:
#   Docker + MongoDB (replica set) + backend (4000) + frontend (12000).
#
# Es idempotente: se puede ejecutar de nuevo aunque parte de la pila ya esté
# arriba. Pensado para recuperar el enlace público cuando el contenedor se
# reinicia y todo se cae (síntoma: 502 Bad Gateway).
#
# Uso:  bash scripts/dev-up.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-12000}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
MONGO_CONTAINER="${MONGO_CONTAINER:-taktak-mongo}"
# Los datos de Mongo viven dentro de /workspace a propósito: es el único
# montaje persistente del contenedor de desarrollo. Un volumen anónimo (o uno
# con nombre) se guarda en /var/lib/docker, que se borra al reiniciar el
# entorno, y con él todas las cuentas y vídeos.
MONGO_DATA_DIR="${MONGO_DATA_DIR:-$ROOT/.data/mongo}"
LOG_DIR="${LOG_DIR:-/tmp}"
RUN_DIR="${RUN_DIR:-$ROOT/.run}"
BACKEND_LOG="$LOG_DIR/taktak-backend.log"
FRONTEND_LOG="$LOG_DIR/taktak-frontend.log"
BACKEND_PID="$RUN_DIR/backend.pid"
FRONTEND_PID="$RUN_DIR/frontend.pid"

# Modo de servicio. `single` (por defecto) sirve la web y la API desde un solo
# proceso Node: la mitad de piezas que se pueden caer y sin el proxy de Vite por
# medio. `split` deja Vite en el frontend para desarrollo con recarga en
# caliente. En `single` el bundle tiene que estar construido, y como vive en
# /workspace sobrevive a un reinicio del entorno.
SERVE_MODE="${SERVE_MODE:-single}"
FRONTEND_DIR="$ROOT/frontend"
FRONTEND_DIST="$FRONTEND_DIR/dist"
REBUILD_FRONTEND="${REBUILD_FRONTEND:-0}"

mkdir -p "$RUN_DIR" "$MONGO_DATA_DIR"

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
err() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

# En este contenedor el usuario no pertenece al grupo `docker`, así que hace
# falta sudo. Se detecta una sola vez en lugar de asumirlo.
if docker info >/dev/null 2>&1; then
  DOCKER="docker"
else
  DOCKER="sudo docker"
fi

port_up() { curl -fsS -o /dev/null --max-time 2 "$1" 2>/dev/null; }

wait_http() { # url, intentos, etiqueta
  local url="$1" tries="${2:-30}" label="$3"
  for _ in $(seq 1 "$tries"); do
    port_up "$url" && { ok "$label listo"; return 0; }
    sleep 1
  done
  err "$label no respondió en $url"; return 1
}

# --- 1. Docker --------------------------------------------------------------
say "Comprobando Docker"
if ! $DOCKER info >/dev/null 2>&1; then
  say "Arrancando el daemon de Docker"
  sudo dockerd >"$LOG_DIR/dockerd.log" 2>&1 &
  for _ in $(seq 1 25); do $DOCKER info >/dev/null 2>&1 && break; sleep 1; done
fi
if $DOCKER info >/dev/null 2>&1; then ok "daemon activo"; else err "no se pudo arrancar Docker"; exit 1; fi

# --- 2. MongoDB (replica set de un nodo) ------------------------------------
say "Comprobando MongoDB"
if ! $DOCKER image inspect mongo:6 >/dev/null 2>&1; then
  say "Descargando imagen mongo:6"
  $DOCKER pull mongo:6 >/dev/null 2>&1
fi

# Un contenedor antiguo puede estar apuntando a un volumen no persistente. Si
# es el caso se recrea conservando el nombre, para que el arreglo surta efecto
# sin que el usuario tenga que borrarlo a mano.
mongo_uses_data_dir() {
  $DOCKER inspect "$MONGO_CONTAINER" \
    --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}' 2>/dev/null |
    grep -qx "$MONGO_DATA_DIR"
}

if $DOCKER ps --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER"; then
  if mongo_uses_data_dir; then
    ok "contenedor ya en marcha"
  else
    say "Recreando el contenedor para usar el volumen persistente"
    $DOCKER rm -f "$MONGO_CONTAINER" >/dev/null
  fi
fi

if ! $DOCKER ps --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER"; then
  if $DOCKER ps -a --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER"; then
    if mongo_uses_data_dir; then
      $DOCKER start "$MONGO_CONTAINER" >/dev/null && ok "contenedor reiniciado"
    else
      say "Recreando el contenedor para usar el volumen persistente"
      $DOCKER rm -f "$MONGO_CONTAINER" >/dev/null
      $DOCKER run -d --name "$MONGO_CONTAINER" -p 27017:27017 \
        -v "$MONGO_DATA_DIR":/data/db \
        mongo:6 mongod --replSet rs0 --bind_ip_all >/dev/null && ok "contenedor creado"
    fi
  else
    $DOCKER run -d --name "$MONGO_CONTAINER" -p 27017:27017 \
      -v "$MONGO_DATA_DIR":/data/db \
      mongo:6 mongod --replSet rs0 --bind_ip_all >/dev/null && ok "contenedor creado"
  fi
fi

say "Iniciando el replica set (necesario para las transacciones)"
for _ in $(seq 1 30); do
  $DOCKER exec "$MONGO_CONTAINER" mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1 && break
  sleep 1
done
$DOCKER exec "$MONGO_CONTAINER" mongosh --quiet --eval '
  try { rs.status() } catch (e) {
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] })
  }' >/dev/null 2>&1

rs_ok() { $DOCKER exec "$MONGO_CONTAINER" mongosh --quiet --eval 'rs.status().ok' 2>/dev/null | tr -d '[:space:]'; }
for _ in $(seq 1 25); do [ "$(rs_ok)" = "1" ] && break; sleep 1; done
[ "$(rs_ok)" = "1" ] && ok "replica set rs0 primario" || { err "el replica set no llegó a primario"; exit 1; }

# --- 3 y 4. Servicio (un proceso o dos) -------------------------------------
#
# En modo `single` la web y la API salen del mismo proceso Node. Eso importa
# para la durabilidad: un reinicio del entorno se lleva los procesos, y cuantas
# menos piezas haya que resucitar, menos formas hay de quedarse a medias. El
# bundle del frontend vive en /workspace, que es lo único persistente, así que
# arrancar no depende de que Vite compile nada.

ensure_frontend_build() {
  [ -f "$FRONTEND_DIST/index.html" ] && return 0
  say "El bundle del frontend no existe; construyéndolo (una sola vez)"
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    ( cd "$FRONTEND_DIR" && npm install --no-audit --no-fund ) || {
      err "no se pudieron instalar las dependencias del frontend"; return 1; }
  fi
  ( cd "$FRONTEND_DIR" && npx vite build ) >"$LOG_DIR/taktak-build.log" 2>&1 || {
    err "falló el build del frontend"; tail -10 "$LOG_DIR/taktak-build.log"; return 1; }
  ok "bundle construido"
}

if [ "$SERVE_MODE" = "single" ]; then
  say "Comprobando el servicio único web+API (:$FRONTEND_PORT)"

  if [ "$REBUILD_FRONTEND" = "1" ]; then
    rm -rf "$FRONTEND_DIST"
  fi
  ensure_frontend_build || exit 1

  # El servicio escucha en el puerto que ve el proxy público y sirve además la
  # API y el socket en el mismo origen, así que aquí no hay nada que proxear.
  if port_up "http://127.0.0.1:$FRONTEND_PORT/api/gifts"; then
    ok "ya está en marcha"
  else
    [ -f "$ROOT/backend/.env" ] || cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
    ( cd "$ROOT/backend" && PORT="$FRONTEND_PORT" PUBLIC_DIR="$FRONTEND_DIST" \
        setsid nohup node src/index.js >"$BACKEND_LOG" 2>&1 </dev/null & echo $! >"$BACKEND_PID" )
    wait_http "http://127.0.0.1:$FRONTEND_PORT/api/gifts" 40 "servicio único" || {
      tail -15 "$BACKEND_LOG"; exit 1; }
  fi

  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$FRONTEND_PORT/")
  [ "$code" = "200" ] && ok "la web responde en :$FRONTEND_PORT" || err "la web devolvió $code"
else
  say "Comprobando el backend (:$BACKEND_PORT)"
  if port_up "http://127.0.0.1:$BACKEND_PORT/health"; then
    ok "ya está en marcha"
  else
    [ -f "$ROOT/backend/.env" ] || cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
    ( cd "$ROOT/backend" && setsid nohup node src/index.js >"$BACKEND_LOG" 2>&1 </dev/null & echo $! >"$BACKEND_PID" )
    wait_http "http://127.0.0.1:$BACKEND_PORT/health" 30 "backend" || { tail -15 "$BACKEND_LOG"; exit 1; }
  fi

  say "Comprobando el frontend (:$FRONTEND_PORT)"
  if port_up "http://127.0.0.1:$FRONTEND_PORT/"; then
    ok "ya está en marcha"
  else
    ( cd "$ROOT/frontend" && PORT="$FRONTEND_PORT" setsid nohup npx vite --host >"$FRONTEND_LOG" 2>&1 </dev/null & echo $! >"$FRONTEND_PID" )
    wait_http "http://127.0.0.1:$FRONTEND_PORT/" 40 "frontend" || { tail -15 "$FRONTEND_LOG"; exit 1; }
  fi

  say "Comprobando el proxy /api a través del frontend"
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$FRONTEND_PORT/api/gifts")
  [ "$code" = "200" ] && ok "/api/gifts responde 200" || err "/api/gifts devolvió $code"
fi

printf '\n\033[1;32m✅ TAK TAK está arriba\033[0m\n'
if [ "$SERVE_MODE" = "single" ]; then
  printf '   Web + API:  http://localhost:%s/\n' "$FRONTEND_PORT"
  printf '   Log:        %s\n' "$BACKEND_LOG"
else
  printf '   Frontend local:  http://localhost:%s/\n' "$FRONTEND_PORT"
  printf '   Backend:         http://localhost:%s/health\n' "$BACKEND_PORT"
  printf '   Logs:            %s  |  %s\n' "$BACKEND_LOG" "$FRONTEND_LOG"
fi

# --- 5. Vigilante -----------------------------------------------------------
# Un solo comando deja la app arriba y además cuidándose. La guarda es
# necesaria: el vigilante llama a este script cuando algo cae, así que sin ella
# cada recuperación arrancaría otro vigilante más.
if [ "${START_WATCHDOG:-1}" = "1" ]; then
  if pgrep -f "scripts/dev-watch.sh" >/dev/null 2>&1; then
    ok "el vigilante ya está activo"
  else
    SERVE_MODE="$SERVE_MODE" FRONTEND_PORT="$FRONTEND_PORT" \
      setsid bash "$ROOT/scripts/dev-watch.sh" >"$LOG_DIR/taktak-watch.log" 2>&1 < /dev/null &
    sleep 1
    pgrep -f "scripts/dev-watch.sh" >/dev/null 2>&1 \
      && ok "vigilante activo (revisa cada ${WATCH_INTERVAL:-15}s)" \
      || err "no se pudo arrancar el vigilante"
  fi
fi
