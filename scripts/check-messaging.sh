#!/usr/bin/env bash
# Prueba manual de recibos y presencia de la mensajería contra el backend real.
set -uo pipefail
API=${API:-http://localhost:4000/api}
S=$(date +%s)

reg() {
  curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"email\":\"$1@example.com\",\"password\":\"secret123\"}"
}

A=$(reg "a$S"); B=$(reg "b$S")
TA=$(echo "$A" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
TB=$(echo "$B" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
IB=$(echo "$B" | python3 -c 'import json,sys;print(json.load(sys.stdin)["user"]["id"])')

CID=$(curl -s -X POST "$API/messages/conversations" -H "Authorization: Bearer $TA" \
  -H 'Content-Type: application/json' -d "{\"userId\":\"$IB\"}" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["conversationId"])')
echo "conversación: $CID"

echo "--- A envía un mensaje ---"
curl -s -X POST "$API/messages/conversations/$CID/messages" -H "Authorization: Bearer $TA" \
  -H 'Content-Type: application/json' -d '{"text":"hola desde A"}' \
  | python3 -c 'import json,sys;print("status:",json.load(sys.stdin)["message"]["status"])'

echo "--- A mira el hilo (B aún no leyó) ---"
curl -s "$API/messages/conversations/$CID/messages" -H "Authorization: Bearer $TA" \
  | python3 -c 'import json,sys;print("status:",json.load(sys.stdin)["messages"][-1]["status"])'

echo "--- B marca como leído ---"
curl -s -X POST "$API/messages/conversations/$CID/read" -H "Authorization: Bearer $TB" \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print("read:",d["read"],"ids:",len(d.get("readIds",[])))'

echo "--- A vuelve a mirar (debe ser read) ---"
curl -s "$API/messages/conversations/$CID/messages" -H "Authorization: Bearer $TA" \
  | python3 -c 'import json,sys;print("status:",json.load(sys.stdin)["messages"][-1]["status"])'

echo "--- presencia del hilo para A ---"
curl -s "$API/messages/conversations/$CID/presence" -H "Authorization: Bearer $TA" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["peers"])'
