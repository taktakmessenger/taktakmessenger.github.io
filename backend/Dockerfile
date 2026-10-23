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
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# --chown no es cosmético: COPY conserva los permisos del repo, que deja los
# fuentes en 660 (lectura solo para el grupo). Con el usuario `node` (uid 1000)
# el proceso moría al arrancar con EACCES al abrir src/index.js. Los ficheros
# tienen que ser legibles por node.
COPY --chown=node:node src ./src

ENV NODE_ENV=production
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
