# better-sqlite3 needs a build toolchain for its native module, so use the full node image.
FROM node:20-bookworm-slim

WORKDIR /app

# Build tools for better-sqlite3's native addon.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Persist the SQLite database across container restarts.
VOLUME /app/data

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["node", "src/server.js"]
