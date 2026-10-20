FROM node:20-alpine

WORKDIR /app

# Install dependencies first so the layer caches across source changes.
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
EXPOSE 4000

# Run as the unprivileged user that the node image ships with.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
