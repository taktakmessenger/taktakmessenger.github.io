#!/usr/bin/env bash
# Recupera TAK TAK de una pasada cuando el contenedor de desarrollo se ha
# reiniciado: arranca Docker, levanta la pila y comprueba la URL pública.
#
# Existe porque `dev-up.sh` no arranca Docker de forma fiable cuando el daemon
# aún no existe: se queda esperando y parece colgado. Aquí Docker se arranca
# primero, desacoplado, y solo después se llama a `dev-up.sh`.
#
# Uso:  bash scripts/revive.sh
#
# Es idempotente: si la pila ya está arriba, no hace nada.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-12000}"
PUBLIC_URL="${PUBLIC_URL:-https://work-1-xjohxhesekhmazjg.prod-runtime.all-hands.dev}"
LOG_DIR="${LOG_DIR:-/tmp}"

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
err() { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

# 1. Docker. Sin el socket no se puede hacer nada, así que se comprueba aquí y
#    se espera de verdad a que esté listo (no solo a que el proceso exista).
if ! sudo docker info >/dev/null 2>&1; then
  say "Arrancando el daemon de Docker"
  sudo nohup dockerd >"$LOG_DIR/dockerd.log" 2>&1 &
  for _ in $(seq 1 40); do
    sudo docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi
if sudo docker info >/dev/null 2>&1; then ok "Docker activo"; else err "Docker no arrancó"; exit 1; fi

# 2. La pila. `dev-up.sh` es idempotente, así que vale tanto si hay que
#    levantarla entera como si solo falta una pieza.
say "Levantando la pila (Docker + MongoDB + web/API)"
if bash "$ROOT/scripts/dev-up.sh" >"$LOG_DIR/revive-devup.log" 2>&1; then
  ok "pila levantada"
else
  err "dev-up.sh falló; últimas líneas:"
  tail -15 "$LOG_DIR/revive-devup.log"
  exit 1
fi

# 3. Comprobación real: la API responde y la base de datos está conectada. Un
#    200 con `db: disconnected` sigue siendo una app rota para el usuario.
say "Comprobando la app"
health="$(curl -fsS --max-time 8 "http://127.0.0.1:${FRONTEND_PORT}/health" 2>/dev/null)"
if printf '%s' "$health" | grep -q '"db":"connected"'; then
  ok "API y base de datos en pie"
else
  err "la API responde pero la base de datos no: $health"
fi

# 4. La URL que ve el usuario, que es la que da el 502.
if [ -n "$PUBLIC_URL" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$PUBLIC_URL" 2>/dev/null)"
  [ "$code" = "200" ] && ok "la URL pública responde 200" || err "la URL pública devolvió $code"
fi

# 5. Vigilante. Mientras el contenedor siga vivo, él solo recupera la pila si
#    algo se cae. No sobrevive a un reinicio del contenedor (nada lo hace),
#    para eso está este script.
if pgrep -f "scripts/dev-watch.sh" >/dev/null 2>&1; then
  ok "vigilante activo"
else
  say "Arrancando el vigilante"
  setsid bash "$ROOT/scripts/dev-watch.sh" >"$LOG_DIR/taktak-watch.log" 2>&1 </dev/null &
  sleep 1
  pgrep -f "scripts/dev-watch.sh" >/dev/null 2>&1 && ok "vigilante activo" || err "no arrancó el vigilante"
fi

printf '\n\033[1;32m✅ TAK TAK recuperada\033[0m\n'
printf '   Web + API:  http://localhost:%s/\n' "$FRONTEND_PORT"
[ -n "$PUBLIC_URL" ] && printf '   Pública:    %s\n' "$PUBLIC_URL"
