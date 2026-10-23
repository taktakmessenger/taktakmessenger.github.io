#!/usr/bin/env bash
# Copia de seguridad de la base de datos TAK TAK.
#
# Escribe un volcado comprimido en .data/backups/ y comprueba que se puede
# restaurar antes de darlo por bueno: una copia que no se ha probado no es una
# copia. Para restaurarla:
#
#   docker exec -i taktak-mongo mongorestore --archive --gzip --drop < copia.gz
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${MONGO_CONTAINER:-taktak-mongo}"
DB="${MONGO_DB:-taktak}"
DIR="$ROOT/.data/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DIR/$DB-$STAMP.gz"

DOCKER="${DOCKER:-sudo docker}"

mkdir -p "$DIR"

if ! $DOCKER ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "El contenedor $CONTAINER no está corriendo." >&2
  exit 1
fi

echo "Volcando $DB..."
$DOCKER exec "$CONTAINER" mongodump --quiet --db "$DB" --archive --gzip > "$OUT"

echo "Verificando la copia..."
$DOCKER exec -i "$CONTAINER" mongorestore --quiet --archive --gzip \
  --nsFrom="$DB.*" --nsTo="${DB}_verify.*" < "$OUT" >/dev/null

USERS=$($DOCKER exec "$CONTAINER" mongosh --quiet "mongodb://localhost:27017/${DB}_verify" \
  --eval 'db.users.countDocuments()')
$DOCKER exec "$CONTAINER" mongosh --quiet "mongodb://localhost:27017/${DB}_verify" \
  --eval 'db.dropDatabase()' >/dev/null

echo "Copia válida: $OUT ($USERS usuarios)"
