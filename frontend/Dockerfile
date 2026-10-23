# --- build ---
FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# --- serve ---
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
# La plantilla se procesa al arrancar (envsubst del entrypoint oficial) y el
# resultado va a /etc/nginx/conf.d/. Así el mismo artefacto sirve en Compose
# (backend:4000, puerto 80) y en Render (URL de la API, puerto de PORT).
COPY templates /etc/nginx/templates

# Valores por defecto para Compose. En Render se sobrescriben con las variables
# del servicio.
ENV PORT=80 \
    BACKEND_URL=http://backend:4000 \
    RESOLVER=127.0.0.11

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
