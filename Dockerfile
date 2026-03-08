# docker build -t flowcrafter-ui
# docker run -p 3000:3000 -v ./data:/data flowcrafter-ui
# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Only what the server needs at runtime
COPY --from=builder /app/dist       ./dist
COPY --from=builder /app/server.js  ./server.js

ENV PORT=3000

EXPOSE 3000

VOLUME ["/data"]

CMD ["node", "server.js"]
