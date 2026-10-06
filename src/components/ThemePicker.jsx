import { useState } from "react";
import { Palette } from "lucide-react";
import { THEMES, applyTheme, getTheme } from "../lib/theme.js";

/** Pemilih tema warna — dipakai di sidebar dan halaman login. */
export default function ThemePicker({ showLabel = false }) {
  const [current, setCurrent] = useState(getTheme);

  function pick(id) {
    setCurrent(applyTheme(id));
  }

  return (
    <div className={showLabel ? "text-center" : ""}>
      {showLabel && (
        <div className="mb-2 flex items-center justify-center gap-1.5 text-[11px] text-mut">
          <Palette size={12} /> Tema warna
        </div>
      )}
      {!showLabel && (
        <div className="mb-2 flex items-center gap-1.5 px-2 text-[11px] text-mut">
          <Palette size={12} /> Tema warna
        </div>
      )}
      <div className={`flex gap-2 ${showLabel ? "justify-center" : "px-2"}`}>
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            title={`${t.name} — ${t.desc}`}
            aria-label={`Tema ${t.name}`}
            onClick={() => pick(t.id)}
            className={`theme-dot ${current === t.id ? "theme-dot-active" : ""}`}
            style={{ backgroundImage: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
          />
        ))}
      </div>
    </div>
  );
}
