import { useEffect, useRef, useState } from "react";
import { ChevronDown, Contrast, MonitorSmartphone, Moon, Palette, Sun } from "lucide-react";
import ThemePicker from "./ThemePicker.jsx";
import { getPrefs, resolveMode } from "../lib/theme.js";

const MODE_ICONS = { terang: Sun, gelap: Moon, pekat: Contrast, auto: MonitorSmartphone };

/**
 * Tombol tampilan di pojok kanan atas.
 * Tertutup secara bawaan (hanya ikon kecil) sehingga tidak mengganggu
 * aplikasi; klik untuk membuka panel mode + warna, klik di luar / Esc untuk
 * menutup kembali.
 */
export default function ThemeMenu({ className = "" }) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(getPrefs);
  const boxRef = useRef(null);

  // Sinkronkan ikon bila diubah dari dalam panel
  useEffect(() => {
    if (open) setPrefs(getPrefs());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ModeIcon = MODE_ICONS[prefs.mode] ?? Moon;
  const modeName = prefs.mode === "auto" ? `Auto (${resolveMode("auto") === "terang" ? "terang" : "gelap"})` : prefs.mode;

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Tampilan: mode terang/gelap & warna aksen"
        aria-label="Pengaturan tampilan"
        aria-expanded={open}
        className={`btn gap-1.5 px-2 py-1.5 text-xs ${open ? "border-acc text-ink" : ""}`}
      >
        <Palette size={14} />
        <ModeIcon size={14} className="text-mut" />
        <ChevronDown size={12} className={`text-mut transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="pop card absolute right-0 top-full z-50 mt-2 w-72 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Tampilan</span>
            <span className="text-[11px] text-mut">klik di luar untuk menutup</span>
          </div>
          <ThemePicker />
          <div className="mt-3 border-t border-line-soft pt-2 text-[11px] text-mut">
            Mode aktif: <span className="font-medium text-ink">{modeName}</span>
          </div>
        </div>
      )}
    </div>
  );
}
