# NEXUS — local-first second-brain command center
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

ENV PORT=4000
EXPOSE 4000

# SQLite database lives here — mount a volume to persist it
VOLUME /app/data

CMD ["node", "server/index.js"]
