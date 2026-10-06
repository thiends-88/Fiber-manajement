// Palet warna aplikasi. Menambah tema baru cukup:
//   1. tambahkan di sini, 2. tambahkan blok html[data-theme="..."] di styles.css
export const THEMES = [
  { id: "aurora", name: "Aurora", desc: "Ungu + cyan", swatch: ["#8b5cf6", "#22d3ee"] },
  { id: "ocean", name: "Samudra", desc: "Biru laut", swatch: ["#3b82f6", "#22d3ee"] },
  { id: "emerald", name: "Zamrud", desc: "Hijau neon", swatch: ["#10b981", "#22d3ee"] },
  { id: "sunset", name: "Senja", desc: "Merah muda + jingga", swatch: ["#e11d48", "#f59e0b"] },
  { id: "neon", name: "Neon", desc: "Lime + magenta", swatch: ["#a3e635", "#d946ef"] },
];

export const DEFAULT_THEME = "aurora";
const KEY = "fiberops_theme";

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    return THEMES.some((t) => t.id === saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(id) {
  const theme = THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* localStorage bisa diblokir — tema tetap jalan untuk sesi ini */
  }
  return theme;
}
