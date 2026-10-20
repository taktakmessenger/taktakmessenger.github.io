#!/usr/bin/env bash
# Comprueba el pipeline completo de vídeo: se genera un clip de prueba, se sube
# por la API y se verifica que salgan el HLS y la miniatura del segundo 1.
#
# Uso: bash scripts/e2e-video-hls.sh
set -u

API=http://127.0.0.1:4000/api
STAMP=$RANDOM
WORK=$(mktemp -d)
UPLOADS=/workspace/project/backend/uploads

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "--- generando clip de 4 s con audio ---"
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "testsrc=size=640x360:rate=25:duration=4" \
  -f lavfi -i "sine=frequency=440:duration=4" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
  "$WORK/clip.mp4"
ls -lh "$WORK/clip.mp4" | awk '{print "  clip:", $5}'

echo "--- registrando usuario ---"
TOKEN=$(curl -s -X POST "$API/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"vid_$STAMP\",\"email\":\"vid_$STAMP@example.com\",\"password\":\"secret123\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

echo "--- subiendo el vídeo ---"
UP=$(curl -s -X POST "$API/videos/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "video=@$WORK/clip.mp4;type=video/mp4" \
  -F "title=Prueba HLS $STAMP")
echo "$UP" | python3 -m json.tool
VID=$(echo "$UP" | python3 -c "import sys,json;print(json.load(sys.stdin)['video']['_id'])")

echo "--- esperando el transcode en segundo plano ---"
for i in $(seq 1 40); do
  STATUS=$(curl -s "$API/videos/$VID" | python3 -c "
import sys,json
v=json.load(sys.stdin)['video']
print(v.get('transcodeStatus','?'))
")
  [ "$STATUS" = "ready" ] && break
  [ "$STATUS" = "failed" ] && break
  sleep 1
done
echo "  transcodeStatus: $STATUS"

echo "--- ficheros generados ---"
find "$UPLOADS/$VID" -type f 2>/dev/null | sort | sed "s|$UPLOADS/$VID|  |"
echo "  miniatura: $(stat -c%s "$UPLOADS/$VID/thumbnail.jpg" 2>/dev/null || echo 0) bytes"

echo "--- detalles del vídeo ---"
curl -s "$API/videos/$VID" | python3 -c "
import sys,json
v=json.load(sys.stdin)['video']
for k in ('hlsUrl','thumbnailUrl','transcodeStatus','duration'):
    print(f'  {k}: {v.get(k)}')
"

echo "--- la playlist maestra apunta a la variante ---"
cat "$UPLOADS/$VID/index.m3u8" 2>/dev/null | sed 's/^/  /'
