# ============================================================
# FiberOps Arena — image produksi
# Satu container = satu proses: API + frontend (port tunggal)
# ============================================================

# Tahap 1: build frontend
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js server.mjs ./
COPY src ./src
COPY server ./server
COPY scripts ./scripts
RUN npm run build

# Tahap 2: runtime — Node + API/helpers/CLI + dist/, tanpa node_modules
# (server.mjs memakai node:sqlite bawaan, tanpa node_modules)
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/server.mjs ./
# server.mjs memakai daftar rasio splitter dari src/lib/fiber.js (satu sumber kebenaran)
COPY --from=build /app/src/lib/fiber.js ./src/lib/fiber.js
COPY --from=build /app/src/lib/interfaces.js ./src/lib/interfaces.js
COPY --from=build /app/src/lib/interface-routes.js ./src/lib/interface-routes.js
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production
ENV ARENA_API_PORT=8080
USER node
EXPOSE 8080
# Folder database (fiberops.db) — pasang volume agar data awet
VOLUME /app/data
CMD ["node", "server.mjs"]
