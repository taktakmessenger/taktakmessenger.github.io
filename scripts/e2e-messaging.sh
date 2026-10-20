#!/usr/bin/env bash
# Prueba de extremo a extremo de la mensajería y la señalización de llamadas.
# Uso: bash scripts/e2e-messaging.sh
set -u

API=http://127.0.0.1:4000/api
SUFFIX=$RANDOM

register() {
  curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"email\":\"$1@example.com\",\"password\":\"secret123\"}"
}

json() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }

A=$(register "ana_$SUFFIX")
B=$(register "bruno_$SUFFIX")
TA=$(echo "$A" | json "['token']")
TB=$(echo "$B" | json "['token']")
IDB=$(echo "$B" | json "['user']['id']")

echo "A=ana_$SUFFIX  B=bruno_$SUFFIX"

CONV=$(curl -s -X POST "$API/messages/conversations" \
  -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$IDB\"}")
CID=$(echo "$CONV" | json "['conversationId']")
echo "conversación creada: $CID"

curl -s -X POST "$API/messages/conversations/$CID/messages" \
  -H "Authorization: Bearer $TA" -H 'Content-Type: application/json' \
  -d '{"text":"Hola Bruno, prueba de TAK TAK"}' > /dev/null

echo "--- bandeja de Bruno ---"
curl -s "$API/messages/conversations" -H "Authorization: Bearer $TB" | python3 -m json.tool

echo "--- hilo visto por Bruno ---"
curl -s "$API/messages/conversations/$CID/messages" -H "Authorization: Bearer $TB" | python3 -m json.tool

echo "--- un tercero intenta leer el hilo (debe dar 404) ---"
C=$(register "carla_$SUFFIX")
TC=$(echo "$C" | json "['token']")
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  "$API/messages/conversations/$CID/messages" -H "Authorization: Bearer $TC"
