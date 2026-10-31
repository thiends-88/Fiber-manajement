import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { FileUp, Focus, Layers, RefreshCw, Route, Trash2 } from "lucide-react";
import { Card, Modal } from "./ui.jsx";
import { ROUTE_NOTICE } from "../lib/cable-routes.js";
const ImportModal = lazy(() => import("./RouteImportModal.jsx"));
export default function CableRoutesPanel({
  state,
  canWrite,
  disabled,
  onFocus,
  onSelect,
  toast,
}) {
  const [importing, setImporting] = useState(false),
    [deleting, setDeleting] = useState(null),
    [deleteError, setDeleteError] = useState("");
  const [query, setQuery] = useState(""),
    [selectedBatch, setSelectedBatch] = useState("");
  const segments = useMemo(
    () =>
      state.visibleRoutes.filter(
        (route) =>
          (!selectedBatch || route.import_id === Number(selectedBatch)) &&
          (!query.trim() ||
            `${route.name} ${route.folder} ${route.batch_name}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())),
      ),
    [state.visibleRoutes, selectedBatch, query],
  );
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [query, selectedBatch, state.visibleRoutes]);
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(segments.length / 20) - 1),
  );
  async function remove() {
    if (state.mutating) return;
    setDeleteError("");
    try {
      await state.remove(deleting.id);
      setDeleting(null);
      toast("Kumpulan jalur dihapus. Inventaris dan mapping tetap utuh.");
    } catch (e) {
      if (e.name !== "AbortError") setDeleteError(e.message);
    }
  }
  return (
    <Card className="route-layer-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="route-layer-icon">
            <Route size={21} />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Jalur kabel impor</h2>
            <p className="mt-1 text-xs text-mut">
              Garis mengikuti berkas Anda, terpisah dari titik perangkat.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {state.bounds && (
            <button
              className="btn text-xs"
              disabled={disabled || state.mutating}
              onClick={() => onFocus(state.bounds)}
            >
              <Focus size={13} /> Fokus semua jalur
            </button>
          )}
          <button
            className="btn text-xs"
            disabled={disabled || state.mutating || state.loading}
            onClick={state.reload}
            aria-label="Muat ulang jalur"
          >
            <RefreshCw size={13} /> Muat ulang jalur
          </button>
          {canWrite && (
            <button
              className="btn btn-primary text-xs"
              disabled={disabled || state.mutating}
              onClick={() => setImporting(true)}
            >
              <FileUp size={14} /> Impor jalur kabel
            </button>
          )}
        </div>
      </div>
      {state.loading && (
        <p className="mt-3 text-xs text-mut" role="status">
          Memuat daftar jalur tersimpan…
        </p>
      )}
      {state.error && (
        <p
          className="mt-3 rounded-lg border border-red-400/30 p-3 text-xs text-red-400"
          role="alert"
        >
          {state.error} Titik inventaris tetap tersedia; KMZ lengkap menunggu
          daftar jalur pulih.
        </p>
      )}
      {state.imports && !state.imports.length && (
        <div className="route-layer-empty">
          <Layers size={24} className="text-acc" />
          <div>
            <p className="text-sm font-semibold">
              Belum ada jalur kabel tersimpan
            </p>
            <p className="mt-1 text-xs text-mut">
              Impor KMZ/KML atau CSV hasil pencatatan Anda. Tidak ada garis
              lurus yang dibuat otomatis.{" "}
              {canWrite
                ? "Pilih berkas, periksa pratinjau, lalu simpan."
                : "Admin/operator dapat menambahkan jalur."}
            </p>
          </div>
        </div>
      )}
      {!!state.imports?.length && (
        <>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="route-count-pill">
              {state.imports.length} kumpulan tersimpan
            </span>
            <span className="route-count-pill">{state.totalRoutes} segmen</span>
            <span className="route-count-pill">
              {state.totalVertices.toLocaleString("id-ID")} titik pembentuk
              garis
            </span>
          </div>
          <p className="mt-3 text-[11px] text-mut">
            Centang untuk menampilkan jalur. Filter OLT/ODC berlaku pada titik
            inventaris, tidak menebak jalur milik perangkat tertentu.
          </p>
          <ul className="mt-2 divide-y divide-line">
            {state.imports.map((batch) => {
              const visible = !state.hidden.has(batch.id),
                loaded = state.visibleRoutes.filter(
                  (route) => route.import_id === batch.id,
                ).length;
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                  key={batch.id}
                  data-route-import={batch.id}
                >
                  <label className="flex min-w-0 flex-1 basis-52 items-start gap-3">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={visible}
                      disabled={disabled || state.mutating}
                      onChange={() => state.toggle(batch.id)}
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold">
                        {batch.name}
                      </span>
                      <span className="mt-1 block break-words text-[11px] text-mut">
                        {batch.source_format} · {batch.route_count} segmen ·{" "}
                        {batch.vertex_count.toLocaleString("id-ID")} titik ·{" "}
                        {batch.source_name}
                      </span>
                      {!!batch.warnings?.length && (
                        <span className="mt-1 block text-[11px] text-amber-300">
                          Catatan impor: {batch.warnings.join(" ")}
                        </span>
                      )}
                      {visible &&
                        loaded < batch.route_count &&
                        !state.geometryErrors[batch.id] && (
                          <span
                            className="mt-1 block text-[11px] text-acc"
                            role="status"
                          >
                            Memuat bentuk jalur…
                          </span>
                        )}
                      {state.geometryErrors[batch.id] && (
                        <span
                          className="mt-1 block text-xs text-red-400"
                          role="alert"
                        >
                          {state.geometryErrors[batch.id]} Coba “Muat ulang
                          jalur”.
                        </span>
                      )}
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      className="btn text-xs"
                      disabled={disabled || !visible || state.mutating}
                      onClick={() => onFocus(batch.bounds)}
                      aria-label={`Fokus kumpulan ${batch.name}`}
                    >
                      <Focus size={13} /> Fokus
                    </button>
                    {canWrite && (
                      <button
                        className="btn text-xs text-red-400"
                        disabled={disabled || state.mutating}
                        onClick={() => {
                          setDeleting(batch);
                          setDeleteError("");
                        }}
                        aria-label={`Hapus kumpulan ${batch.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <details className="mt-2 rounded-xl border border-line bg-panel2 p-3">
            <summary className="cursor-pointer text-xs font-semibold">
              Telusuri segmen jalur ({state.visibleRoutes.length} dimuat)
            </summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                className="input"
                aria-label="Cari segmen jalur"
                placeholder="Cari nama segmen/folder…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className="input"
                aria-label="Kumpulan segmen jalur"
                value={selectedBatch}
                onChange={(e) => setSelectedBatch(e.target.value)}
              >
                <option value="">Semua kumpulan yang tampil</option>
                {state.visibleImports.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.name}
                  </option>
                ))}
              </select>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {segments
                .slice(currentPage * 20, (currentPage + 1) * 20)
                .map((route) => (
                  <li
                    className="flex items-center justify-between gap-2 py-2"
                    key={route.id}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2 w-6 shrink-0 rounded"
                        style={{ background: route.color }}
                      />
                      <span className="min-w-0 break-words text-xs">
                        #{route.id} · {route.name}
                        <span className="block text-[11px] text-mut">
                          {route.batch_name} · {route.coordinates.length} titik
                          bentuk garis
                        </span>
                      </span>
                    </span>
                    <button
                      className="btn text-xs"
                      onClick={() => onSelect(route)}
                      disabled={disabled}
                      aria-label={`Detail segmen #${route.id}`}
                    >
                      Detail / fokus
                    </button>
                  </li>
                ))}
            </ul>
            {!segments.length && (
              <p className="mt-3 text-xs text-mut">
                Tidak ada segmen yang cocok/dinyalakan.
              </p>
            )}
            {segments.length > 20 && (
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <button
                  className="btn"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Sebelumnya
                </button>
                <span>
                  {currentPage + 1} / {Math.ceil(segments.length / 20)}
                </span>
                <button
                  className="btn"
                  disabled={(currentPage + 1) * 20 >= segments.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Berikutnya
                </button>
              </div>
            )}
          </details>
        </>
      )}
      <p className="mt-3 text-[11px] text-mut">{ROUTE_NOTICE}</p>
      {importing && (
        <Suspense
          fallback={
            <p role="status" className="mt-3 text-xs">
              Menyiapkan dialog impor…
            </p>
          }
        >
          <ImportModal
            state={state}
            onClose={() => setImporting(false)}
            onSaved={(batch) => {
              setImporting(false);
              onFocus(batch.bounds);
              toast(
                `Tersimpan: ${batch.route_count} segmen jalur. Inventaris tidak diubah.`,
              );
            }}
          />
        </Suspense>
      )}
      <Modal
        open={!!deleting}
        title="Hapus kumpulan jalur?"
        onClose={() => setDeleting(null)}
        busy={state.mutating}
      >
        <p className="text-sm">
          Hapus <strong>{deleting?.name}</strong> beserta{" "}
          {deleting?.route_count} segmennya dari peta dan ekspor berikutnya?
        </p>
        <p className="mt-2 text-xs text-mut">
          Titik OLT/ODC/ODP, GPS, akun, feeder dan mapping core tidak dihapus.
          Simpan berkas sumber bila ingin mengimpor kembali.
        </p>
        {deleteError && (
          <p className="mt-3 text-xs text-red-400" role="alert">
            {deleteError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="btn"
            disabled={state.mutating}
            onClick={() => setDeleting(null)}
          >
            Batal
          </button>
          <button
            className="btn border-red-400/40 text-red-400"
            disabled={state.mutating}
            onClick={remove}
          >
            {state.mutating ? "Menghapus…" : "Hapus hanya jalur ini"}
          </button>
        </div>
      </Modal>
    </Card>
  );
}
export function ImportedRouteDetail({ route, onClose }) {
  return (
    <section
      aria-label="Detail jalur kabel impor"
      data-selected-route={route.id}
    >
      <Card>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold text-emerald-400">
            JALUR IMPOR · #{route.id}
          </span>
          <button className="btn text-xs" onClick={onClose}>
            Tutup
          </button>
        </div>
        <h2 className="mt-3 break-words text-base font-semibold">
          {route.name}
        </h2>
        <div
          className="mt-2 h-1 w-12 rounded"
          style={{ background: route.color }}
        />
        <dl className="mt-4 space-y-3 break-words text-xs">
          {[
            ["Kumpulan", route.batch_name],
            ["Sumber", route.source_name],
            ["Folder asli", route.folder || "Tidak ada"],
            ["Bentuk jalur", `${route.coordinates.length} titik berurutan`],
            ["Catatan sumber", route.description || "Tidak ada catatan"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-mut">{label}</dt>
              <dd className="mt-1 whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 rounded-lg border border-line bg-panel2 p-3 text-[11px] text-mut">
          {ROUTE_NOTICE} Tidak ada hubungan inventaris yang disimpulkan dari
          garis ini.
        </p>
      </Card>
    </section>
  );
}
