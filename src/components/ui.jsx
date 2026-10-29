import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef } from "react";
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
  const generatedId = useId();
  const nativeField = isValidElement(children) && ["input", "select", "textarea"].includes(children.type);
  const id = nativeField ? children.props.id || generatedId : undefined;
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>{label}</label>
      {nativeField ? cloneElement(children, { id }) : children}
    </div>
  );
}

export function Modal({ open, title, onClose, children, wide, busy = false }) {
  const dialog = useRef(null), close = useRef(onClose), titleId = useId();
  close.current = () => { if (!busy) onClose?.(); };
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...(dialog.current?.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])].filter((el) => !el.hidden);
    (dialog.current?.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || focusable()[0] || dialog.current)?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); close.current?.(); }
      if (event.key !== "Tab") return;
      const nodes = focusable(), first = nodes[0], last = nodes[nodes.length - 1];
      if (!nodes.length) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={() => close.current?.()}>
      <div
        ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}
        className={`card max-h-[85vh] w-full overflow-y-auto p-5 ${wide ? "max-w-4xl" : "max-w-md"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button type="button" className="text-mut hover:text-ink" onClick={() => close.current?.()} disabled={busy} aria-label="Tutup">
            <X size={18} />
          </button>
        </div>
        <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">{children}</fieldset>
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
      role={ok ? "status" : "alert"}
      className={`toast ${ok ? "toast-ok" : "toast-err"}`}
    >
      {toast.message}
    </div>
  );
}

export function useToast(setter) {
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(
    (message, type = "success") => {
      setter({ message, type });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setter(null), 3000);
    },
    [setter],
  );
}
