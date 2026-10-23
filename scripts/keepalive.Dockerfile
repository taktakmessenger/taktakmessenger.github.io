# Imagen mínima para el keep-alive. No copia el repositorio: solo el script,
# así que no necesita montar nada del proyecto ni instalar dependencias.
FROM node:20-slim

WORKDIR /app

# --chown porque la imagen de node trae el usuario `node` y el proceso corre
# como él; sin esto el script no sería legible.
COPY --chown=node:node keepalive.js ./keepalive.js

USER node

CMD ["node", "keepalive.js"]
