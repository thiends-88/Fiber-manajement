// Uji otomatis: render tiap halaman aplikasi (jsdom) dengan data sungguhan
// dari server, memastikan tidak ada halaman yang "blank" / error render.
// Berkas ini hanya untuk pengujian lokal, tidak dipakai aplikasi.
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { AuthProvider } from "../src/lib/auth.jsx";

// Rute + teks DATA yang wajib muncul. Halaman yang error/blank biasanya masih
// menampilkan header tapi data demo tidak ikut ter-render, jadi penanda ini kuat.
const ROUTES = [
  ["/", ["Alur Core", "SPL-1"]], // halaman utama: pohon jalur core benar-benar tergambar
  ["/dashboard", ["Core Terdaftar", "Card terpasang", "Port terpakai", "Kapasitas", "OLT-PST-01", "GTGO", "GTGH"]],
  ["/olt", "OLT-PST-01"],
  ["/odc", ["ODC-001", "ODC anak", "Splitter di ODC-001", "Tahap 2", "SPL-2"]], // buka ODC dan cek cascade bertingkat
  ["/odp", "ODP-001"],
  ["/mapping", "Sambungan Kabel Langsung"],
  ["/peta", ["Peta Jaringan / KMZ", "Unduh KMZ Lengkap", "Belum ada koordinat", "OLT-PST-01"]],
  ["/laporan", "OLT-PST-01"],
  ["/users", "admin@arena.test"],
  ["/topologi", ["Alur Core", "SPL-1"]], // bookmark lama → halaman utama
  ["/login", ["Alur Core", "SPL-1"]], // sudah login → dialihkan ke halaman utama
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

// jsdom tidak punya layout/SVG geografis. Leaflet nyata punya suite Chromium terpisah.
function SmokeMapCanvas({ points }) { return <div role="region" aria-label="Kanvas peta uji DOM">{points.length} titik valid</div>; }

// Konten API/cascade bisa selesai setelah 300 ms saat suite berjalan serentak.
// Tunggu perubahan DOM yang diharapkan dengan batas waktu, bukan memperbesar sleep.
function waitForDom(div, ready, timeout) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const finish = () => { observer.disconnect(); clearTimeout(timer); resolve(); };
    const observer = new window.MutationObserver(() => { if (ready()) finish(); });
    observer.observe(div, { childList: true, subtree: true, characterData: true });
    timer = setTimeout(finish, timeout);
  });
}

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
            <App MapCanvasComponent={SmokeMapCanvas} />
          </AuthProvider>
        </MemoryRouter>,
      );
      // Pertahankan waktu observasi baseline untuk error dari efek lanjutan.
      await new Promise((resolve) => setTimeout(resolve, tunggu));
      if (route === "/odc") {
        const findOdc = () => [...div.querySelectorAll("tbody tr")].find((row) => row.textContent.includes("ODC-001"));
        await waitForDom(div, () => Boolean(findOdc()), 5000);
        findOdc()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      const expected = Array.isArray(wajib) ? wajib : [wajib];
      await waitForDom(div, () => expected.every((value) => (div.querySelector("main") || div).textContent.replace(/\s+/g, " ").includes(value)), 5000);
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
    const mainText = ((div.querySelector("main") || div).textContent || "").replace(/\s+/g, " ").trim();
    const kurang = wajibArr.filter((w) => !mainText.includes(w));
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
    // Sama seperti run(): timer nyata memberi kesempatan efek/fetch halaman
    // selesai. Membungkus seluruh jeda dalam act() menahan commit React 19
    // sampai snapshot diambil, sehingga data tampak belum dimuat padahal API OK.
    root.render(
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <App MapCanvasComponent={SmokeMapCanvas} />
        </AuthProvider>
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, tunggu));
  } catch (e) {
    thrown = String(e && e.stack ? e.stack : e);
  }
  const text = (div.textContent || "").replace(/\s+/g, " ").trim();
  try { root.unmount(); } catch { /* abaikan */ }
  div.remove();
  console.error = orig;
  console.warn = origW;
  return { route, text, msgs, thrown };
}
