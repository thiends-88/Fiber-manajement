# ============================================================
# FiberOps Arena — image produksi
# Satu container = satu proses: API + frontend (port tunggal)
# ============================================================

# Tahap 1: build frontend
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# Tahap 2: runtime — hanya Node + server.mjs + dist/
# (server.mjs memakai node:sqlite bawaan, tanpa node_modules)
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/server.mjs ./
COPY --from=build /app/dist ./dist
ENV ARENA_API_PORT=8080
EXPOSE 8080
# Folder database (fiberops.db) — pasang volume agar data awet
VOLUME /app/data
CMD ["node", "server.mjs"]
