// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Build for Node.js server (Proxmox / VPS self-host).
  // Aman untuk build Lovable: platform Lovable memaksa preset cloudflare
  // via LOVABLE_NITRO_PRESET, sehingga override ini hanya berlaku di luar Lovable.
  nitro: { preset: "node-server" },
  // ARENA MODE: dev server bisa diakses lewat proxy preview (host eksternal)
  // dan meneruskan panggilan Supabase ke mock server lokal (arena/mock-supabase.mjs).
  vite: {
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/auth/v1": { target: "http://127.0.0.1:54321", changeOrigin: true },
        "/rest/v1": { target: "http://127.0.0.1:54321", changeOrigin: true },
      },
    },
  },
});
