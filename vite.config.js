import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Arena live-preview friendly: bind ke semua interface, izinkan host proxy
// eksternal, dan teruskan /api ke server SQLite lokal (server.mjs, port 4500).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 8080,
    allowedHosts: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:4500", changeOrigin: true },
    },
  },
});
