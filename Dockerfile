# docker build -t flowcrafter-ui .
# docker run -p 5173:5173 -v ./data:/flowcrafter/data flowcrafter-ui
# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /flowcrafter

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /flowcrafter

# Only what the server needs at runtime
COPY --from=builder /flowcrafter/dist        ./dist
COPY --from=builder /flowcrafter/server.js   ./server.js
COPY --from=builder /flowcrafter/package*.json ./
RUN npm ci --omit=dev

ENV PORT=5173

EXPOSE 5173

VOLUME ["/flowcrafter/data"]

CMD ["node", "server.js"]
