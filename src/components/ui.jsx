import { useCallback } from "react";
import { Search, X } from "lucide-react";

export function PageHeader({ title, desc, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="page-title">{title}</h1>
        {desc && <p className="mt-1 text-sm text-mut">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

export function Card({ className = "", children }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

export function Badge({ cls, children }) {
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function Field({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export function Modal({ open, title, onClose, children, wide }) {
  if (!open) return null;
  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className={`card max-h-[85vh] w-full overflow-y-auto p-5 ${wide ? "max-w-4xl" : "max-w-md"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="text-mut hover:text-ink" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Kotak pencarian seragam untuk daftar OLT / ODC / ODP
export function SearchBox({ value, onChange, placeholder = "Cari…", className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mut" />
      <input
        className="input pl-8 pr-8"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-mut hover:text-ink"
          onClick={() => onChange("")}
          aria-label="Bersihkan pencarian"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// true bila salah satu field mengandung query (tanpa membedakan huruf besar/kecil)
export const matchesQuery = (query, ...fields) => {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f ?? "").toLowerCase().includes(q));
};

export function Empty({ text }) {
  return <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-mut">{text}</div>;
}

export function Toast({ toast }) {
  if (!toast) return null;
  const ok = toast.type === "success";
  return (
    <div
      className={`toast ${ok ? "toast-ok" : "toast-err"}`}
    >
      {toast.message}
    </div>
  );
}

let toastTimer = null;
export function useToast(setter) {
  return useCallback(
    (message, type = "success") => {
      setter({ message, type });
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setter(null), 3000);
    },
    [setter],
  );
}
