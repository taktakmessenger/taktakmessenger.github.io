#!/usr/bin/env bash
# Prueba de humo de la API completa: recorre cada módulo de TAK TAK y comprueba
# que responde lo que debe. No sustituye a los tests unitarios: verifica que la
# pila levantada (Mongo + backend + proxy) funciona de verdad de punta a punta.
#
# Uso: bash scripts/smoke-api.sh
set -u

API=${API:-http://127.0.0.1:4000/api}
SUFFIX=${SUFFIX:-$RANDOM}
PASS=0
FAIL=0

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { PASS=$((PASS+1)); printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

# Comprueba que un valor JSON cumple una condición expresada en Python.
# Uso: check <etiqueta> <json> <expresión python con `d`>
check() {
  local label="$1" body="$2" expr="$3"
  if echo "$body" | python3 -c "import sys,json;d=json.load(sys.stdin);sys.exit(0 if ($expr) else 1)" 2>/dev/null; then
    ok "$label"
  else
    bad "$label -> $body"
  fi
}

jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }

# --- Auth -------------------------------------------------------------------
say "Auth: registro"
A=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"ana_$SUFFIX\",\"email\":\"ana_$SUFFIX@example.com\",\"password\":\"secret123\"}")
TA=$(echo "$A" | jget "['token']")
IDA=$(echo "$A" | jget "['user']['id']")
[ -n "$TA" ] && ok "registro devuelve token" || bad "registro sin token: $A"
check "registro da 100 monedas de bienvenida" "$(curl -s "$API/wallet" -H "Authorization: Bearer $TA")" "d['bonusCoins']==100"

B=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"bruno_$SUFFIX\",\"email\":\"bruno_$SUFFIX@example.com\",\"password\":\"secret123\"}")
TB=$(echo "$B" | jget "['token']")
IDB=$(echo "$B" | jget "['user']['id']")

say "Auth: login y credenciales"
L=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"ana_$SUFFIX@example.com\",\"password\":\"secret123\"}")
check "login correcto devuelve token" "$L" "'token' in d"
BAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"ana_$SUFFIX@example.com\",\"password\":\"malo\"}")
[ "$BAD" = "400" ] && ok "contraseña incorrecta rechazada (400)" || bad "login malo devolvió $BAD"

say "Auth: sesión requerida"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/wallet")
[ "$CODE" = "401" ] && ok "wallet sin sesión da 401" || bad "wallet sin sesión dio $CODE"

say "Auth: verificación de email (código de desarrollo)"
VC=$(echo "$A" | jget "['verificationCode']")
if [ -n "$VC" ]; then
  V=$(curl -s -X POST "$API/auth/verify-email" -H 'Content-Type: application/json' \
    -d "{\"email\":\"ana_$SUFFIX@example.com\",\"code\":\"$VC\"}")
  check "verify-email acepta el código" "$V" "d.get('verified') is True"
else
  ok "sin código devuelto (correo entregado): se omite verificación"
fi

# --- Vídeo ------------------------------------------------------------------
say "Vídeo: subida"
printf 'contenido-de-prueba' > /tmp/smoke.mp4
# El tipo hay que declararlo: curl no adivina `video/mp4` para un archivo sin
# extensión reconocible y el filtro del servidor lo rechazaría.
UP=$(curl -s -X POST "$API/videos/upload" -H "Authorization: Bearer $TA" \
  -F "video=@/tmp/smoke.mp4;type=video/mp4" -F "title=Prueba $SUFFIX" -F "description=smoke" -F "tags=prueba" -F "duration=5")
VID=$(echo "$UP" | jget "['video']['_id']")
[ -n "$VID" ] && ok "subida crea vídeo" || bad "subida falló: $UP"

say "Feed"
FY=$(curl -s "$API/feed/for-you?limit=10")
check "feed for-you devuelve lista" "$FY" "isinstance(d.get('videos'), list)"
N=$(echo "$FY" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['videos']))")
[ "$N" -ge 1 ] && ok "el vídeo subido aparece en el feed ($N)" || bad "feed vacío tras subir"

say "Vídeo: like idempotente"
L1=$(curl -s -X POST "$API/videos/$VID/like" -H "Authorization: Bearer $TB")
L2=$(curl -s -X POST "$API/videos/$VID/like" -H "Authorization: Bearer $TB")
check "primer like suma" "$L1" "d['liked'] is True and d['likes']==1"
check "segundo like retira (toggle)" "$L2" "d['liked'] is False and d['likes']==0"

say "Vídeo: detalle y no autorizado"
DET=$(curl -s "$API/videos/$VID")
check "detalle de vídeo accesible" "$DET" "d.get('video',{}).get('_id')=='$VID'"

# --- Comentarios ------------------------------------------------------------
say "Comentarios"
C1=$(curl -s -X POST "$API/comments/video/$VID" -H "Authorization: Bearer $TB" \
  -H 'Content-Type: application/json' -d '{"text":"Buen video"}')
CID=$(echo "$C1" | jget "['comment']['_id']")
[ -n "$CID" ] && ok "comentario creado" || bad "comentario falló: $C1"
LC=$(curl -s "$API/comments/video/$VID")
check "el comentario aparece en la lista" "$LC" "len(d.get('comments',[]))>=1"
check "like a comentario" "$(curl -s -X POST "$API/comments/$CID/like" -H "Authorization: Bearer $TA")" "d.get('likes',0)>=1"
check "borrar comentario propio" "$(curl -s -X DELETE "$API/comments/$CID" -H "Authorization: Bearer $TB")" "d.get('deleted') is True"

# --- Social -----------------------------------------------------------------
say "Social: perfil y seguir"
check "perfil ajeno sin sesión" "$(curl -s "$API/users/ana_$SUFFIX")" "d['user']['username']=='ana_$SUFFIX'"
check "seguir a un usuario" "$(curl -s -X POST "$API/users/ana_$SUFFIX/follow" -H "Authorization: Bearer $TB")" "d['following'] is True"
check "perfil refleja el seguidor" "$(curl -s "$API/users/ana_$SUFFIX")" "len(d['user']['profile']['followers'])>=1"
check "dejar de seguir" "$(curl -s -X DELETE "$API/users/ana_$SUFFIX/follow" -H "Authorization: Bearer $TB")" "d['following'] is False"
SELF=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/users/ana_$SUFFIX/follow" -H "Authorization: Bearer $TA")
[ "$SELF" = "400" ] && ok "autoseguimiento rechazado (400)" || bad "autoseguimiento dio $SELF"
check "editar perfil" "$(curl -s -X PATCH "$API/users/me" -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"displayName":"Bruno Smoke","bio":"hola"}')" "d['user']['profile']['displayName']=='Bruno Smoke'"

# --- Wallet -----------------------------------------------------------------
say "Wallet: saldos, regalo y retiro"
check "wallet muestra saldos" "$(curl -s "$API/wallet" -H "Authorization: Bearer $TB")" "'coins' in d and 'bonusCoins' in d and 'diamonds' in d"
# Bruno intenta una rosa de 300 con sus 100 monedas de bienvenida: primero se
# comprueba que el rechazo por saldo insuficiente es correcto.
GIFT=$(curl -s -X POST "$API/wallet/gift" -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' \
  -d "{\"recipientId\":\"$IDA\",\"giftName\":\"Rosa\",\"giftCost\":300}")
check "regalo sin saldo se rechaza con claridad" "$GIFT" "'insuficiente' in d.get('error','').lower() or d.get('error')"
# Ahora un regalo que sí puede pagar.
GOK=$(curl -s -X POST "$API/wallet/gift" -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' \
  -d "{\"recipientId\":\"$IDA\",\"giftName\":\"Rosa\",\"giftCost\":50}")
check "regalo pagable se acepta" "$GOK" "d.get('transaction',{}).get('amount')==50"
# El regalo lo paga Bruno con monedas de bienvenida, que no son retirables: Ana
# recibe monedas de bono, NO diamantes. Es la salvaguarda que impide blanquear
# dinero regalando monedas gratis entre cuentas propias.
check "el regalo con monedas de bono no genera diamantes retirables" \
  "$(curl -s "$API/wallet" -H "Authorization: Bearer $TA")" "d['diamonds']==0 and d['bonusCoins']>=130"
TXS=$(curl -s "$API/wallet/transactions" -H "Authorization: Bearer $TB")
check "historial de transacciones del emisor" "$TXS" "isinstance(d, list) and len(d)>=1"

say "Wallet: monetización abierta"
MON=$(curl -s "$API/wallet/monetization" -H "Authorization: Bearer $TA")
check "monetización abierta sin requisitos" "$MON" "d['eligible'] is True and d['requirements']['minFollowers']==0"

say "Wallet: reparto 60/40 con monedas pagadas"
# Las monedas de bienvenida no producen diamantes, así que para probar el
# reparto real hace falta el camino de las monedas pagadas. Se concede saldo
# pagado por la vía de admin (no hay pasarela en las pruebas) y se comprueba
# que el creador recibe exactamente el 60% en diamantes retirables.
ADM="${SMOKE_ADMIN_TOKEN:-}"
if [ -n "$ADM" ]; then
  IDC=$(curl -s "$API/auth/register" -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"creadora_$SUFFIX\",\"email\":\"creadora_$SUFFIX@example.com\",\"password\":\"secret123\"}" | jget "['user']['id']")
  TC=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"creadora_$SUFFIX@example.com\",\"password\":\"secret123\"}" | jget "['token']")
  curl -s -o /dev/null -X POST "$API/admin/users/$IDB/credit" -H "Authorization: Bearer $ADM" \
    -H 'Content-Type: application/json' -d '{"amount":1000,"bucket":"ttcC"}'
  PG=$(curl -s -X POST "$API/wallet/gift" -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' \
    -d "{\"recipientId\":\"$IDC\",\"giftName\":\"Rosa\",\"giftCost\":300}")
  check "regalo pagado se acepta" "$PG" "d.get('transaction',{}).get('amount')==300"
  check "el creador recibe el 60% en diamantes retirables (300 -> 180)" \
    "$(curl -s "$API/wallet" -H "Authorization: Bearer $TC")" "d['diamonds']==180"
  W1=$(curl -s -X POST "$API/wallet/withdraw" -H "Authorization: Bearer $TC" -H 'Content-Type: application/json' \
    -d '{"amount":100,"method":"paypal","details":"carla@example.com"}')
  check "retiro dentro del saldo se acepta" "$W1" "'amount' in d or 'message' in d"
  check "el retiro descuenta del saldo" "$(curl -s "$API/wallet" -H "Authorization: Bearer $TC")" "d['diamonds']==80"
else
  printf '\033[1;33m  ⚠ reparto 60/40 omitido: exporta SMOKE_ADMIN_TOKEN para probarlo\033[0m\n'
fi

W2=$(curl -s -X POST "$API/wallet/withdraw" -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' \
  -d '{"amount":99999,"method":"paypal"}')
check "retiro por encima del saldo se rechaza" "$W2" "d.get('error')"

# --- Mensajería -------------------------------------------------------------
say "Mensajería"
CONV=$(curl -s -X POST "$API/messages/conversations" -H "Authorization: Bearer $TA" \
  -H 'Content-Type: application/json' -d "{\"userId\":\"$IDB\"}")
CID2=$(echo "$CONV" | jget "['conversationId']")
[ -n "$CID2" ] && ok "conversación creada" || bad "conversación falló: $CONV"
curl -s -X POST "$API/messages/conversations/$CID2/messages" -H "Authorization: Bearer $TA" \
  -H 'Content-Type: application/json' -d '{"text":"Hola Bruno"}' > /dev/null
INBOX=$(curl -s "$API/messages/conversations" -H "Authorization: Bearer $TB")
check "Bruno ve la conversación en su bandeja" "$INBOX" "len(d.get('conversations',[]))>=1"
THREAD=$(curl -s "$API/messages/conversations/$CID2/messages" -H "Authorization: Bearer $TB")
check "Bruno ve el mensaje en el hilo" "$THREAD" "any(m.get('text')=='Hola Bruno' for m in d.get('messages',[]))"
# Un desconocido no puede leer el hilo.
C=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"carla_$SUFFIX\",\"email\":\"carla_$SUFFIX@example.com\",\"password\":\"secret123\"}")
TC=$(echo "$C" | jget "['token']")
INTRUSO=$(curl -s -o /dev/null -w '%{http_code}' "$API/messages/conversations/$CID2/messages" -H "Authorization: Bearer $TC")
[ "$INTRUSO" = "404" ] && ok "un tercero no puede leer el hilo (404)" || bad "fuga de hilo: $INTRUSO"

# --- Squads -----------------------------------------------------------------
say "TAK Creators"
SQ=$(curl -s -X POST "$API/squads" -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Squad $SUFFIX\",\"description\":\"prueba\",\"visibility\":\"public\"}")
SLUG=$(echo "$SQ" | jget "['squad']['slug']")
[ -n "$SLUG" ] && ok "creator creado ($SLUG)" || bad "creator falló: $SQ"
check "otro usuario se une al creator público" "$(curl -s -X POST "$API/squads/$SLUG/join" -H "Authorization: Bearer $TB")" "d.get('joined') is True"
check "listado de creators (con sesión)" "$(curl -s "$API/squads" -H "Authorization: Bearer $TA")" "isinstance(d.get('squads'), list)"
check "detalle del creator para miembros" "$(curl -s "$API/squads/$SLUG/feed" -H "Authorization: Bearer $TB")" "d.get('squad',{}).get('slug')=='$SLUG' and len(d.get('members',[]))>=2"
check "salir del creator" "$(curl -s -X DELETE "$API/squads/$SLUG/leave" -H "Authorization: Bearer $TB")" "d.get('joined') is False"

# --- Salud de cuenta --------------------------------------------------------
say "Salud de cuenta (anti-shadowban)"
HEALTH=$(curl -s "$API/health" -H "Authorization: Bearer $TA")
check "salud devuelve visibilidad" "$HEALTH" "'visibility' in d or 'status' in d or 'score' in d"

# --- Analítica y feed personalizado -----------------------------------------
say "Analítica y personalización"
W=$(curl -s -X POST "$API/analytics/watch" -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' \
  -d "{\"videoId\":\"$VID\",\"watchDuration\":3}")
check "registro de visualización" "$W" "d.get('recorded') is True and 'completionRate' in d"
check "ocultar creador" "$(curl -s -X POST "$API/feed/hide-creator" -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d "{\"creatorId\":\"$IDA\"}")" "'error' not in d"
check "ocultar etiqueta" "$(curl -s -X POST "$API/feed/hide-tag" -H "Authorization: Bearer $TB" -H 'Content-Type: application/json' -d '{"tag":"prueba"}')" "'error' not in d"

# --- Catálogo de regalos y sonidos ------------------------------------------
say "Catálogos"
check "catálogo de regalos" "$(curl -s "$API/gifts")" "isinstance(d.get('gifts'), list) and len(d['gifts'])>0"
check "catálogo de sonidos" "$(curl -s "$API/sounds")" "'error' not in d"

# --- Admin ------------------------------------------------------------------
say "Admin: control de acceso"
ADM=$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/stats" -H "Authorization: Bearer $TA")
[ "$ADM" = "403" ] || [ "$ADM" = "401" ] && ok "admin bloqueado a usuarios normales ($ADM)" || bad "admin accesible sin rol: $ADM"

# --- ICE de llamadas --------------------------------------------------------
say "Llamadas: configuración ICE"
ICE=$(curl -s "$API/calls/ice" -H "Authorization: Bearer $TA")
check "ICE incluye STUN" "$ICE" "any('stun:' in str(s.get('urls')) for s in d['iceServers'])"
check "ICE marca si hay TURN" "$ICE" "'hasTurn' in d"

# --- Resultado --------------------------------------------------------------
printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf '\033[1;32m✅ API completa en verde: %d comprobaciones\033[0m\n' "$PASS"
  exit 0
else
  printf '\033[1;31m❌ %d fallos de %d comprobaciones\033[0m\n' "$FAIL" "$((PASS+FAIL))"
  exit 1
fi
