# docker build -t flowcrafter-ui .
# docker run -p 5173:5173 -v ./data:/flowcrafter/data flowcrafter-ui
# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /flowcrafter

COPY package*.json ./
RUN npm ci

ARG APP_VERSION=dev
RUN echo $APP_VERSION > /flowcrafter/VERSION

COPY . .
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:24-alpine

WORKDIR /flowcrafter

# Only what the server needs at runtime
COPY --from=builder /flowcrafter/dist        ./dist
COPY --from=builder /flowcrafter/server.js   ./server.js
COPY --from=builder /flowcrafter/VERSION     ./VERSION
COPY --from=builder /flowcrafter/package*.json ./
RUN npm ci --omit=dev

ENV PORT=5173

EXPOSE 5173

VOLUME ["/flowcrafter/data"]

CMD ["node", "server.js"]
