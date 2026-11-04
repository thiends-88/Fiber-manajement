import { useEffect, useRef, useState } from "react";
import { FileUp, ShieldCheck } from "lucide-react";
import { Field, Modal } from "./ui.jsx";
import { getSessionVersion } from "../lib/api.js";
import { ROUTE_NOTICE } from "../lib/cable-routes.js";

function Preview({ result }) {
  const [w, s, e, n] = result.bounds;
  const dx = Math.max(e - w, 0.000001),
    dy = Math.max(n - s, 0.000001),
    scale = Math.min(550 / dx, 155 / dy);
  const x = (lon) => 300 + (lon - (w + e) / 2) * scale;
  const y = (lat) => 90 - (lat - (s + n) / 2) * scale;
  return (
    <div className="route-preview">
      <svg
        viewBox="0 0 600 180"
        role="img"
        aria-label={`Pratinjau ${result.route_count} segmen jalur tanpa peta dasar`}
      >
        {result.routes.slice(0, 80).map((route, i) => {
          const stride = Math.max(1, Math.ceil(route.coordinates.length / 100));
          const sampled = route.coordinates.filter(
            (_, j) => j % stride === 0 || j === route.coordinates.length - 1,
          );
          return (
            <polyline
              key={i}
              points={sampled
                .map(
                  ([lon, lat]) => `${x(lon).toFixed(2)},${y(lat).toFixed(2)}`,
                )
                .join(" ")}
              fill="none"
              stroke={route.color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <p className="px-3 pb-3 text-[11px] text-mut">
        Pratinjau bentuk jalur, tanpa latar jalan. Cuplikan visual
        disederhanakan; seluruh koordinat yang valid tetap disimpan.
      </p>
    </div>
  );
}
export default function RouteImportModal({ state, onClose, onSaved }) {
  const [parsing, setParsing] = useState(false),
    [result, setResult] = useState(null),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [ack, setAck] = useState(false);
  const task = useRef(null),
    mounted = useRef(true),
    generation = useRef(0),
    saving = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      task.current?.cancel();
    };
  }, []);
  async function choose(file) {
    const current = ++generation.current,
      session = getSessionVersion();
    task.current?.cancel();
    setResult(null);
    setError("");
    setAck(false);
    if (!file) {
      setParsing(false);
      return;
    }
    setParsing(true);
    try {
      const { startRouteImport } = await import(
        "../lib/route-import-client.js"
      );
      if (
        !mounted.current ||
        current !== generation.current ||
        session !== getSessionVersion()
      )
        return;
      task.current = startRouteImport(file);
      const parsed = await task.current.promise;
      if (
        !mounted.current ||
        current !== generation.current ||
        session !== getSessionVersion()
      )
        return;
      setResult(parsed);
      setName(parsed.name);
    } catch (e) {
      if (
        mounted.current &&
        current === generation.current &&
        e.name !== "AbortError"
      )
        setError(e.message);
    } finally {
      if (mounted.current && current === generation.current) setParsing(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    if (
      !result ||
      parsing ||
      saving.current ||
      state.mutating ||
      (result.warnings.length && !ack)
    )
      return;
    saving.current = true;
    setError("");
    try {
      const saved = await state.create({
        name,
        source_name: result.source_name,
        source_format: result.source_format,
        warnings: result.warnings,
        routes: result.routes,
      });
      if (mounted.current) onSaved(saved);
    } catch (e) {
      if (mounted.current && e.name !== "AbortError") setError(e.message);
    } finally {
      saving.current = false;
    }
  }
  return (
    <Modal
      open
      title="Impor jalur kabel"
      onClose={onClose}
      wide
      busy={state.mutating}
    >
      <form onSubmit={save} className="space-y-4">
        <div className="route-upload-note">
          <FileUp size={25} className="shrink-0 text-acc" />
          <div>
            <p className="font-semibold">Bawa jalur lapangan Anda ke peta</p>
            <p className="mt-1 text-xs text-mut">
              KMZ · KML / XML · CSV. Maksimal 3 MB, 500 segmen, 20.000 titik
              pembentuk garis per impor. Pemrosesan berjalan di latar belakang
              browser, bukan saat membuka halaman lain.
            </p>
          </div>
        </div>
        <Field label="Berkas jalur kabel">
          <input
            className="input"
            type="file"
            accept=".kmz,.kml,.xml,.csv"
            onChange={(e) => choose(e.target.files?.[0])}
          />
        </Field>
        {parsing && (
          <div className="route-upload-note" role="status">
            <span className="route-spinner" />
            Membaca dan memeriksa jalur… Anda dapat menutup dialog untuk
            membatalkan.
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-400/30 p-3 text-sm text-red-400"
          >
            {error}
          </p>
        )}
        {result && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                [result.route_count, "segmen jalur"],
                [
                  result.vertex_count.toLocaleString("id-ID"),
                  "titik pembentuk garis",
                ],
                [result.source_format, "format terbaca"],
              ].map(([value, label]) => (
                <div
                  className="rounded-xl border border-line bg-panel2 p-3"
                  key={label}
                >
                  <p className="text-lg font-semibold">{value}</p>
                  <p className="mt-1 text-[11px] text-mut">{label}</p>
                </div>
              ))}
            </div>
            <Preview result={result} />
            <Field label="Nama kumpulan jalur">
              <input
                className="input"
                maxLength={160}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-xs font-semibold">
                Lihat contoh segmen ({Math.min(result.route_count, 12)} dari{" "}
                {result.route_count})
              </summary>
              <ul className="mt-2 divide-y divide-line">
                {result.routes.slice(0, 12).map((route, i) => (
                  <li className="flex items-center gap-2 py-2 text-xs" key={i}>
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: route.color }}
                    />
                    <span className="min-w-0 flex-1 break-words">
                      #{i + 1} · {route.name}
                    </span>
                    <span className="shrink-0 text-mut">
                      {route.coordinates.length} titik
                    </span>
                  </li>
                ))}
              </ul>
            </details>
            {!!result.warnings.length && (
              <div className="rounded-xl border border-amber-400/30 p-3 text-xs text-amber-300">
                <ul className="list-disc space-y-2 pl-4">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                <label className="mt-3 flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />
                  <span>
                    Saya memahami bagian yang diabaikan. Hanya segmen yang
                    berhasil dibaca pada ringkasan impor yang akan disimpan.
                  </span>
                </label>
              </div>
            )}
          </>
        )}
        <div className="flex gap-2 rounded-lg bg-panel2 p-3 text-xs text-mut">
          <ShieldCheck size={16} className="shrink-0 text-emerald-400" />
          <p>
            {ROUTE_NOTICE} Impor tidak menambah perangkat atau menimpa GPS,
            akun, maupun mapping inventaris. Nama yang sama tetap segmen
            berbeda.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              !result ||
              parsing ||
              state.mutating ||
              !name.trim() ||
              (!!result?.warnings.length && !ack)
            }
          >
            {state.mutating ? "Menyimpan jalur…" : "Simpan jalur ke peta"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
