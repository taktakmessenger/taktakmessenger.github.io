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
# Fondo azul liso a propósito: así la única tinta roja del clip es la marca
# ajena y la única blanca es la de TAK TAK, y las comprobaciones de píxeles
# miden lo que deben (con una imagen de colores, el rojo y el blanco están por
# todas partes y no se puede distinguir nada). El recuadro rojo simula la marca
# quemada que traen los vídeos bajados de otra red, en la esquina inferior
# izquierda, que es donde suele estar. El clip es vertical, como uno real.
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "color=c=0x1030a0:size=360x640:rate=25:duration=4" \
  -f lavfi -i "sine=frequency=440:duration=4" \
  -vf "drawbox=x=10:y=ih-90:w=140:h=60:color=red@1.0:t=fill" \
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
echo "--- 2) la marca de TAK TAK está impresa abajo a la izquierda ---"
# La marca vive en la esquina inferior izquierda (donde la otra red pone su
# sello). Se busca tinta clara dentro de esa zona y se comprueba que no haya
# marca centrada, que es lo que delataría una posición equivocada.
ffmpeg -hide_banner -loglevel error -sseof -0.5 -i "$SEG" -frames:v 1 "$WORK/frame.png" -y
ffmpeg -hide_banner -loglevel error -i "$WORK/frame.png" -vf "format=gray" "$WORK/full.pgm" -y
read -r LEFT CENTER < <(python3 - "$WORK/full.pgm" <<'PY'
import sys
with open(sys.argv[1], 'rb') as f:
    data = f.read()
parts = data.split(b'\n', 3)
w, h = map(int, parts[1].split())
px = parts[3]
# Zona inferior (último 25%) partida en dos mitades: izquierda y centro.
y0 = int(h * 0.75)
left = center = 0
for y in range(y0, h):
    for x in range(w):
        if px[y * w + x] > 200:
            if x < w // 2:
                left += 1
            else:
                center += 1
print(left, center)
PY
)
echo "  píxeles claros — mitad izquierda: $LEFT, mitad derecha: $CENTER"
if [ "$LEFT" -gt 300 ] && [ "$LEFT" -gt "$CENTER" ]; then
  echo "  ✅ la marca TAK TAK se ve abajo a la izquierda"
else
  echo "  ❌ la marca no está donde debería"
fi

echo
echo "--- 4) la placa TAK TAK tapa la marca quemada del vídeo ajeno ---"
# El clip trae un recuadro rojo en la esquina inferior izquierda (la marca
# ajena). Si la placa de TAK TAK está donde debe y es opaca, ese rojo
# desaparece. Se cuenta el rojo puro en el original y en el resultado.
redcount() {
  python3 - "$1" "$2" <<'PY'
import subprocess, sys
# Se decodifica el primer fotograma a RGB crudo para contar píxeles sin
# depender de librerías de imagen.
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',sys.argv[1],
                '-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',sys.argv[2],'-y'], check=True)
d = open(sys.argv[2],'rb').read()
red = sum(1 for i in range(0, len(d)-2, 3) if d[i] > 170 and d[i+1] < 70 and d[i+2] < 70)
print(red)
PY
}
RED_IN=$(redcount "$WORK/clip.mp4" "$WORK/in.raw")
RED_OUT=$(redcount "$WORK/frame.png" "$WORK/out.raw")
echo "  píxeles rojos (marca ajena) — en el original: $RED_IN, tras el proceso: $RED_OUT"
if [ "$RED_IN" -gt 1000 ] && [ "$RED_OUT" -lt $((RED_IN / 10)) ]; then
  echo "  ✅ la marca ajena quedó tapada por la placa de TAK TAK"
else
  echo "  ❌ la marca ajena sigue visible ($RED_OUT de $RED_IN)"
fi

echo
echo "--- 3) la miniatura también lleva la marca ---"
ffmpeg -hide_banner -loglevel error -i "$UPLOADS/$VID/thumbnail.jpg" -vf "crop=iw/2:ih/4:0:ih*3/4,format=gray" "$WORK/thumb-bottom.pgm" -y
TB=$(python3 - "$WORK/thumb-bottom.pgm" <<'PY'
import sys
with open(sys.argv[1], 'rb') as f:
    data = f.read()
parts = data.split(b'\n', 3)
print(sum(1 for b in parts[3] if b > 200))
PY
)
echo "  píxeles claros en la esquina inferior izquierda de la miniatura: $TB"
if [ "$TB" -gt 300 ]; then
  echo "  ✅ la miniatura lleva la marca"
else
  echo "  ❌ la miniatura no lleva la marca"
fi
