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

# --- 3. Backend -------------------------------------------------------------
say "Comprobando el backend (:$BACKEND_PORT)"
if port_up "http://127.0.0.1:$BACKEND_PORT/health"; then
  ok "ya está en marcha"
else
  [ -f "$ROOT/backend/.env" ] || cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  ( cd "$ROOT/backend" && nohup node src/index.js >"$BACKEND_LOG" 2>&1 & echo $! >"$BACKEND_PID" )
  wait_http "http://127.0.0.1:$BACKEND_PORT/health" 30 "backend" || { tail -15 "$BACKEND_LOG"; exit 1; }
fi

# --- 4. Frontend ------------------------------------------------------------
say "Comprobando el frontend (:$FRONTEND_PORT)"
if port_up "http://127.0.0.1:$FRONTEND_PORT/"; then
  ok "ya está en marcha"
else
  ( cd "$ROOT/frontend" && PORT="$FRONTEND_PORT" nohup npx vite --host >"$FRONTEND_LOG" 2>&1 & echo $! >"$FRONTEND_PID" )
  wait_http "http://127.0.0.1:$FRONTEND_PORT/" 40 "frontend" || { tail -15 "$FRONTEND_LOG"; exit 1; }
fi

say "Comprobando el proxy /api a través del frontend"
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$FRONTEND_PORT/api/gifts")
[ "$code" = "200" ] && ok "/api/gifts responde 200" || err "/api/gifts devolvió $code"

printf '\n\033[1;32m✅ TAK TAK está arriba\033[0m\n'
printf '   Frontend local:  http://localhost:%s/\n' "$FRONTEND_PORT"
printf '   Backend:         http://localhost:%s/health\n' "$BACKEND_PORT"
printf '   Logs:            %s  |  %s\n' "$BACKEND_LOG" "$FRONTEND_LOG"
