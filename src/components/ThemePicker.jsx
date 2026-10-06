import { useEffect, useState } from "react";
import { Contrast, MonitorSmartphone, Moon, Palette, Sun } from "lucide-react";
import { ACCENTS, MODES, applyTheme, getPrefs } from "../lib/theme.js";

const MODE_ICONS = {
  terang: Sun,
  gelap: Moon,
  pekat: Contrast,
  auto: MonitorSmartphone,
};

/** Isi pengaturan tampilan: pilih mode (terang/gelap/pekat/auto) + warna aksen. */
export default function ThemePicker({ compact = false }) {
  const [prefs, setPrefs] = useState(getPrefs);

  // Ikut berubah otomatis saat mode "auto" dan sistem berganti tema
  useEffect(() => {
    if (prefs.mode !== "auto") return;
    let media;
    try {
      media = window.matchMedia("(prefers-color-scheme: light)");
    } catch {
      return;
    }
    const onChange = () => setPrefs(applyTheme(prefs));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [prefs]);

  function pick(patch) {
    setPrefs(applyTheme({ ...prefs, ...patch }));
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-mut">
          <Sun size={12} /> Mode
        </div>
        <div className="flex gap-1.5">
          {MODES.map((m) => {
            const Icon = MODE_ICONS[m.id] ?? Moon;
            return (
              <button
                key={m.id}
                type="button"
                title={`${m.name} — ${m.desc}`}
                aria-label={`Mode ${m.name}`}
                onClick={() => pick({ mode: m.id })}
                className={`mode-btn ${prefs.mode === m.id ? "mode-btn-active" : ""}`}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
        <div className="mt-1 text-[10px] text-mut">
          {MODES.find((m) => m.id === prefs.mode)?.desc}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-mut">
          <Palette size={12} /> Warna aksen
        </div>
        <div className="flex gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              title={`${a.name} — ${a.desc}`}
              aria-label={`Warna ${a.name}`}
              onClick={() => pick({ accent: a.id })}
              className={`theme-dot ${prefs.accent === a.id ? "theme-dot-active" : ""}`}
              style={{ backgroundImage: `linear-gradient(135deg, ${a.swatch[0]}, ${a.swatch[1]})` }}
            />
          ))}
        </div>
        <div className="mt-1 text-[10px] text-mut">
          {ACCENTS.find((a) => a.id === prefs.accent)?.desc}
        </div>
      </div>
    </div>
  );
}
