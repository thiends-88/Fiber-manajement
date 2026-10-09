// Uji otomatis: render tiap halaman aplikasi (jsdom) dengan data sungguhan
// dari server, memastikan tidak ada halaman yang "blank" / error render.
// Berkas ini hanya untuk pengujian lokal, tidak dipakai aplikasi.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { AuthProvider } from "../src/lib/auth.jsx";

// Rute + teks DATA yang wajib muncul. Halaman yang error/blank biasanya masih
// menampilkan header tapi data demo tidak ikut ter-render, jadi penanda ini kuat.
const ROUTES = [
  ["/", ["Alur Core", "SPL-1"]], // halaman utama: pohon jalur core benar-benar tergambar
  ["/dashboard", "Core Terdaftar"],
  ["/olt", "OLT-PST-01"],
  ["/odc", ["ODC-001", "ODC anak"]], // badge ODC anak harus tampil
  ["/odp", "ODP-001"],
  ["/mapping", "Sambungan Kabel Langsung"],
  ["/laporan", "OLT-PST-01"],
  ["/users", "admin@arena.test"],
  ["/topologi", ["Alur Core", "SPL-1"]], // bookmark lama → halaman utama
  ["/login", "Alur Core"], // sudah login → dialihkan ke halaman utama
];

// Jejak error yang TIDAK boleh muncul di halaman
const TERLARANG = [
  "is not defined",
  "Maximum call stack",
  "Cannot read propert",
  "Minified React error",
  "Objects are not valid",
  "Cannot access",
  "undefined is not",
];

export async function run(tunggu = 1200) {
  const results = [];
  for (const [route, wajib] of ROUTES) {
    const errors = [];
    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...a) => errors.push(a.map((x) => (x && x.message) || String(x)).join(" "));
    console.warn = () => {};
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    let thrown = null;
    try {
      root.render(
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </MemoryRouter>,
      );
      await new Promise((r) => setTimeout(r, tunggu));
    } catch (e) {
      thrown = e;
    }
    const text = (div.textContent || "").replace(/\s+/g, " ").trim();
    const navLabels = [...div.querySelectorAll("nav a")].map((a) => a.textContent.replace(/\s+/g, " ").trim());
    const mappingIndex = navLabels.indexOf("Mapping Core");
    const alurIndex = navLabels.indexOf("Alur Core");
    const navOrderOk = mappingIndex >= 0 && alurIndex === mappingIndex + 1;
    const bad = errors.filter((e) => /is not defined|Cannot read|not a function|Minified React error|Objects are not valid|Cannot access/.test(e));
    const wajibArr = Array.isArray(wajib) ? wajib : [wajib];
    const kurang = wajibArr.filter((w) => !text.includes(w));
    const adaData = kurang.length === 0;
    const terlarang = TERLARANG.find((t) => text.includes(t));
    results.push({
      route,
      chars: text.length,
      sample: text.slice(0, 70),
      text,
      ok: !thrown && bad.length === 0 && adaData && navOrderOk && !terlarang,
      problem: thrown
        ? String(thrown.message).slice(0, 200)
        : bad[0]
          ? bad[0].slice(0, 240)
          : !navOrderOk
            ? `urutan menu sidebar tidak sesuai: ${navLabels.join(" → ")}`
            : terlarang
              ? `halaman memuat pesan error "${terlarang}" (ekor teks: ${text.slice(-160)})`
              : !adaData
                ? `data tidak ter-render — "${kurang.join('", "')}" tidak muncul (ekor teks: ${text.slice(-200)})`
                : "",
    });
    try { root.unmount(); } catch { /* abaikan */ }
    div.remove();
    console.error = origError;
    console.warn = origWarn;
  }
  return results;
}

// Mode fokus: satu rute, kembalikan teks penuh + semua pesan konsol
export async function renderOne(route, tunggu = 1500) {
  const msgs = [];
  const orig = console.error;
  const origW = console.warn;
  console.error = (...a) => msgs.push(a.map((x) => (x && x.stack) || String(x)).join(" | "));
  console.warn = (...a) => msgs.push("WARN " + a.map(String).join(" "));
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  let thrown = null;
  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </MemoryRouter>,
      );
      await new Promise((r) => setTimeout(r, tunggu));
    });
  } catch (e) {
    thrown = String(e && e.stack ? e.stack : e);
  }
  const text = (div.textContent || "").replace(/\s+/g, " ").trim();
  try { await act(async () => root.unmount()); } catch { /* abaikan */ }
  div.remove();
  console.error = orig;
  console.warn = origW;
  return { route, text, msgs, thrown };
}
