// Uji tata letak runtime: memastikan server tetap bisa jalan HANYA dengan file
// yang benar-benar disalin oleh Dockerfile. Menangkap bug seperti ini:
// server.mjs mengimpor modul dari src/ tetapi image tidak menyalinnya →
// container langsung mati saat start (ERR_MODULE_NOT_FOUND).
//
//   npm run test:layout   (butuh dist/ — jalankan `npm run build` dulu)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.UJI_LAYOUT_PORT || 4699);
const BASE = `http://127.0.0.1:${PORT}`;

if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
  console.error("dist/ belum ada. Jalankan dulu: npm run build");
  process.exit(2);
}

// Ambil daftar file yang disalin ke image dari Dockerfile itu sendiri,
// supaya uji ini ikut menyesuaikan bila Dockerfile berubah.
const dockerfile = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
const salinan = [...dockerfile.matchAll(/^COPY --from=build \/app\/(.+?) +\.?\/(.*)$/gm)]
  .map((m) => ({ dari: m[1].trim(), ke: (m[2].trim() || path.basename(m[1].trim())).replace(/^\.\//, "") }))
  .filter((c) => !c.ke.startsWith("data"));
if (salinan.length === 0) {
  console.error("Tidak menemukan baris 'COPY --from=build' di Dockerfile.");
  process.exit(2);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiberops-layout-"));
let gagal = 0;
for (const c of salinan) {
  const asal = path.join(ROOT, c.dari);
  const tujuan = path.join(TMP, c.ke);
  fs.mkdirSync(path.dirname(tujuan), { recursive: true });
  fs.cpSync(asal, tujuan, { recursive: true });
  console.log(`  salin ${c.dari} → ${c.ke}`);
}

const server = spawn("node", ["server.mjs"], {
  cwd: TMP,
  env: { ...process.env, ARENA_API_PORT: String(PORT), ARENA_DB_PATH: path.join(TMP, "data", "uji.db") },
  stdio: ["ignore", "pipe", "pipe"],
});

function selesai(kode) {
  server.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(kode);
}

let out = "";
let sudahCek = false;
const timer = setTimeout(() => {
  console.error(`  GAGAL server tidak siap dalam 20 detik.\n${out}`);
  selesai(1);
}, 20000);

server.stdout.on("data", (d) => {
  out += d.toString();
  if (out.includes("siap di") && !sudahCek) {
    sudahCek = true;
    clearTimeout(timer);
    (async () => {
      try {
        const r = await fetch(`${BASE}/healthz`);
        const data = await r.json();
        if (r.status === 200 && data.ok) {
          console.log(`  OK    server jalan di layout runtime Docker (${salinan.length} file disalin)`);
          const r2 = await fetch(`${BASE}/api/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "admin@arena.test", password: "Arena123!" }),
          });
          console.log(r2.status === 200 ? "  OK    login demo berhasil di layout runtime" : `  GAGAL login → ${r2.status}`);
          if (r2.status !== 200) gagal++;
        } else {
          console.error("  GAGAL /healthz tidak OK");
          gagal++;
        }
      } catch (e) {
        console.error(`  GAGAL server tidak merespons: ${e.message}`);
        gagal++;
      }
      console.log(gagal === 0 ? "\nLAYOUT: lolos" : "\nLAYOUT: gagal");
      selesai(gagal ? 1 : 0);
    })();
  }
});
server.stderr.on("data", (d) => {
  out += d.toString();
});
server.on("exit", (kode) => {
  clearTimeout(timer);
  console.error(`  GAGAL server mati saat start (kode ${kode}):\n${out}`);
  selesai(1);
});
