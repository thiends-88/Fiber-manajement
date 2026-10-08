// Pengaturan tampilan Fiber Manajement Core: MODE (terang/gelap/pekat/auto)
// dikombinasikan dengan AKSEN (warna). Menambah pilihan cukup menambah entri
// di bawah + blok CSS yang sesuai di src/styles.css.

export const MODES = [
  { id: "terang", name: "Terang", desc: "Putih bersih" },
  { id: "gelap", name: "Gelap", desc: "Abu gelap" },
  { id: "pekat", name: "Pekat", desc: "Hitam pekat" },
  { id: "auto", name: "Auto", desc: "Ikut pengaturan sistem" },
];

export const ACCENTS = [
  { id: "aurora", name: "Aurora", desc: "Ungu + cyan", swatch: ["#8b5cf6", "#22d3ee"] },
  { id: "ocean", name: "Samudra", desc: "Biru laut", swatch: ["#3b82f6", "#22d3ee"] },
  { id: "emerald", name: "Zamrud", desc: "Hijau", swatch: ["#10b981", "#22d3ee"] },
  { id: "sunset", name: "Senja", desc: "Merah muda + jingga", swatch: ["#e11d48", "#f59e0b"] },
  { id: "neon", name: "Neon", desc: "Lime + magenta", swatch: ["#a3e635", "#d946ef"] },
];

export const DEFAULT_MODE = "gelap";
export const DEFAULT_ACCENT = "aurora";
const KEY = "fiberops_theme_v2";
const LEGACY_KEY = "fiberops_theme";

const isMode = (id) => MODES.some((m) => m.id === id);
const isAccent = (id) => ACCENTS.some((a) => a.id === id);

export function getPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    let accent = isAccent(raw.accent) ? raw.accent : null;
    if (!accent) {
      // kompatibel dengan pilihan tema versi sebelumnya
      const old = localStorage.getItem(LEGACY_KEY);
      if (isAccent(old)) accent = old;
    }
    return {
      mode: isMode(raw.mode) ? raw.mode : DEFAULT_MODE,
      accent: accent ?? DEFAULT_ACCENT,
    };
  } catch {
    return { mode: DEFAULT_MODE, accent: DEFAULT_ACCENT };
  }
}

/** "auto" mengikuti pengaturan sistem operasi pengguna. */
export function resolveMode(mode) {
  if (mode !== "auto") return isMode(mode) ? mode : DEFAULT_MODE;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "terang" : "gelap";
  } catch {
    return DEFAULT_MODE;
  }
}

const CHROME_COLOR = { terang: "#f3f5fa", gelap: "#0b0d15", pekat: "#000000" };

export function applyTheme(prefs) {
  const next = {
    mode: isMode(prefs?.mode) ? prefs.mode : DEFAULT_MODE,
    accent: isAccent(prefs?.accent) ? prefs.accent : DEFAULT_ACCENT,
  };
  const html = document.documentElement;
  const mode = resolveMode(next.mode);
  html.dataset.mode = mode;
  html.dataset.accent = next.accent;
  // warna bilah browser di ponsel mengikuti mode aktif
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", CHROME_COLOR[mode] ?? CHROME_COLOR[DEFAULT_MODE]);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage bisa diblokir — tampilan tetap jalan untuk sesi ini */
  }
  return next;
}
