#!/usr/bin/env bash
# Comprueba el pipeline completo de vídeo: se genera un clip de prueba, se sube
# por la API y se verifica que salgan el HLS y la miniatura del segundo 1.
#
# Uso: bash scripts/e2e-video-hls.sh
#   API_BASE permite apuntar a otro sitio (por ejemplo el 12000 en modo single).
set -u

API="${API_BASE:-http://127.0.0.1:4000}/api"
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
  -metadata title="Video de TikTok" \
  -metadata artist="@usuario_tiktok" \
  -metadata comment="https://www.tiktok.com/@usuario_tiktok/video/123" \
  -metadata description="descargado de tiktok" \
  "$WORK/clip.mp4"
ls -lh "$WORK/clip.mp4" | awk '{print "  clip:", $5}'

echo "--- metadatos del clip de origen (simula un vídeo bajado de TikTok) ---"
ffprobe -v error -show_entries format_tags -of default=nw=1 "$WORK/clip.mp4" | sed 's/^/  /'

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

echo
echo "--- 0) el archivo original servido también quedó limpio ---"
ORIG=$(find "$UPLOADS" -maxdepth 1 -type f -name "$(basename "$(curl -s "$API/videos/$VID" | python3 -c "import sys,json;print(json.load(sys.stdin)['video']['videoUrl'])")")" 2>/dev/null | head -1)
if [ -z "$ORIG" ]; then
  ORIG=$(find "$UPLOADS" -maxdepth 1 -type f -name "*.mp4" -newermt '-3 minutes' | head -1)
fi
echo "  original: $(basename "$ORIG")"
ffprobe -v error -show_entries format_tags -of default=nw=1 "$ORIG" | sed 's/^/    /'
OLEAK=$(ffprobe -v error -show_entries format_tags -of default=nw=1 "$ORIG" | grep -i "tiktok\|usuario_tiktok\|descargado" || true)
if [ -z "$OLEAK" ]; then
  echo "  ✅ el original servido no tiene rastro de TikTok"
else
  echo "  ❌ EL ORIGINAL CONSERVA RASTRO: $OLEAK"
fi

echo
echo "--- 1) no queda rastro de TikTok en los metadatos ---"
REND="$UPLOADS/$VID/480p/index.m3u8"
SEG=$(find "$UPLOADS/$VID/480p" -name 'segment_*.ts' | sort | head -1)
echo "  metadatos del segmento HLS:"
ffprobe -v error -show_entries format_tags -of default=nw=1 "$SEG" | sed 's/^/    /'
LEAK=$(ffprobe -v error -show_entries format_tags -of default=nw=1 "$SEG" | grep -i "tiktok\|usuario_tiktok\|descargado" || true)
if [ -z "$LEAK" ]; then
  echo "  ✅ sin rastro de TikTok (ni título, ni autor, ni enlace, ni comentario)"
else
  echo "  ❌ QUEDA RASTRO: $LEAK"
fi

echo
echo "--- 2) la marca de TAK TAK está impresa en los píxeles ---"
# Se saca el último fotograma del segmento: la marca vive abajo, así que se
# recorta esa franja y se comprueba que hay tinta clara sobre la caja oscura.
ffmpeg -hide_banner -loglevel error -sseof -0.5 -i "$SEG" -frames:v 1 "$WORK/frame.png" -y
ffmpeg -hide_banner -loglevel error -i "$WORK/frame.png" -vf "crop=iw:ih/6:0:ih*5/6,format=gray" "$WORK/bottom.pgm" -y
BRIGHT=$(python3 - "$WORK/bottom.pgm" <<'PY'
import sys
with open(sys.argv[1], 'rb') as f:
    data = f.read()
# Cabecera PGM: P5 <w> <h> <max>\n<datos>. Se localiza el final de la cabecera.
parts = data.split(b'\n', 3)
pixels = parts[3]
bright = sum(1 for b in pixels if b > 200)
print(bright)
PY
)
echo "  píxeles claros en la franja inferior: $BRIGHT"
if [ "$BRIGHT" -gt 200 ]; then
  echo "  ✅ la marca TAK TAK se ve en el vídeo"
else
  echo "  ❌ no se ve la marca (pocos píxeles claros)"
fi

echo
echo "--- 3) la miniatura también lleva la marca ---"
ffmpeg -hide_banner -loglevel error -i "$UPLOADS/$VID/thumbnail.jpg" -vf "crop=iw:ih/6:0:ih*5/6,format=gray" "$WORK/thumb-bottom.pgm" -y
TB=$(python3 - "$WORK/thumb-bottom.pgm" <<'PY'
import sys
with open(sys.argv[1], 'rb') as f:
    data = f.read()
parts = data.split(b'\n', 3)
print(sum(1 for b in parts[3] if b > 200))
PY
)
echo "  píxeles claros en la franja inferior de la miniatura: $TB"
if [ "$TB" -gt 200 ]; then
  echo "  ✅ la miniatura lleva la marca"
else
  echo "  ❌ la miniatura no lleva la marca"
fi
