# El frontend se construye aquí dentro, en una etapa aparte, para que un clon
# recién bajado compile sin tener que ejecutar antes `npm run build` a mano.
# Node en Debian, no Alpine, para no arrastrar dos bases distintas: el backend ya
# necesita Debian por mediasoup.
FROM node:20-slim AS web

WORKDIR /web

# Cachea la capa de dependencias aparte de los fuentes.
COPY frontend/package*.json ./
RUN npm ci || npm install

COPY frontend/ ./
RUN npm run build

FROM node:20-slim

WORKDIR /app

# Install dependencies first so the layer caches across source changes.
#
# The base image is Debian and not Alpine on purpose. mediasoup (the voice room)
# ships a prebuilt worker binary that does not run on musl, so on Alpine npm
# falls back to compiling it from source and fails: the build stops with
# "/bin/sh: python: not found". On Debian the prebuilt binary is used as is and
# the install finishes in seconds. Do not switch back to alpine without
# installing python3, make and g++ in the image.
#
# ffmpeg es la optimización de vídeo (el HLS y la miniatura). Sin él la subida
# sigue funcionando, pero el vídeo se sirve tal cual y el creador ve "No se pudo
# optimizar": `transcodeService.hasFfmpeg()` es false y `/retranscode` responde
# 503. Se instala aquí y no se asume del host, porque la imagen es lo único que
# se despliega.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# --chown no es cosmético: COPY conserva los permisos del repo, que deja los
# fuentes en 660 (lectura solo para el grupo). Con el usuario `node` (uid 1000)
# el proceso moría al arrancar con EACCES al abrir src/index.js. Los ficheros
# tienen que ser legibles por node.
COPY --chown=node:node backend/src ./src

# El frontend ya construido, para que un solo servicio sirva la web y la API.
# Se copia de la etapa `web`, no del disco: así el build no depende de que
# alguien haya ejecutado `npm run build` antes de desplegar.
COPY --from=web --chown=node:node /web/dist ./public

ENV NODE_ENV=production
ENV PUBLIC_DIR=/app/public
EXPOSE 4000

# Uploads live here. A persistent disk is mounted over this path in production,
# so it is created and chowned before dropping privileges: a mount owned by root
# would leave the node user unable to write a single video.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# Run as the unprivileged user that the node image ships with.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
