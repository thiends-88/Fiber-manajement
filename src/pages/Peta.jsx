import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { Download, LocateFixed, MapPin, Pencil, RefreshCw } from "lucide-react";
import { api, getSessionVersion } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { coordinateForm, coordinateText } from "../lib/coordinates.js";
import {
  buildNetworkMap,
  filterNetworkMap,
  MAP_TYPES,
  SCHEMATIC_NOTICE,
} from "../lib/network-map.js";
import CoordinateFields from "../components/CoordinateFields.jsx";
import {
  Card,
  Field,
  Modal,
  PageHeader,
  SearchBox,
  Toast,
  useToast,
} from "../components/ui.jsx";
import "../map.css";

const Canvas = lazy(() => import("../components/NetworkMapCanvas.jsx"));
const EMPTY_FILTERS = { oltId: "", odcId: "", kind: "", query: "" };
const SNAPSHOT_KEYS = [
  "olts",
  "odcs",
  "odps",
  "ports",
  "feederPorts",
  "interfaceMappings",
  "links",
  "splitters",
];
function validateSnapshot(data) {
  const row = (item) =>
    item && typeof item === "object" && !Array.isArray(item);
  if (
    data?.version !== 1 ||
    !SNAPSHOT_KEYS.every(
      (key) => Array.isArray(data[key]) && data[key].every(row),
    ) ||
    !data.splitters.every(
      (s) => Array.isArray(s.outputs) && s.outputs.every(row),
    )
  )
    throw new Error(
      "Snapshot peta belum lengkap/valid. Periksa versi server lalu muat ulang; ekspor tidak memakai data setengah lengkap.",
    );
  return data;
}
class MapBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <Card>
        <p role="alert">
          Kanvas peta belum dapat dimuat. Daftar titik dan ekspor KMZ tetap
          tersedia.
        </p>
        <button className="btn mt-3" onClick={() => window.location.reload()}>
          Muat ulang halaman
        </button>
      </Card>
    ) : (
      this.props.children
    );
  }
}
function DeviceList({ nodes, name, onSelect, onEdit, canWrite }) {
  const [page, setPage] = useState(0),
    size = 50;
  useEffect(() => setPage(0), [nodes]);
  const last = Math.max(0, Math.ceil(nodes.length / size) - 1),
    current = Math.min(page, last);
  if (!nodes.length)
    return (
      <p className="py-3 text-xs text-mut">
        Tidak ada perangkat pada daftar ini.
      </p>
    );
  return (
    <>
      <ul className="divide-y divide-line">
        {nodes.slice(current * size, (current + 1) * size).map((node) => (
          <li
            key={node.key}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
            data-device-key={node.key}
          >
            <div className="min-w-0 flex-1 basis-48">
              <button
                className="break-words text-left text-sm font-semibold text-acc hover:underline"
                onClick={() => onSelect(node.key, true)}
              >
                {node.name}
              </button>
              <p className="break-words text-xs text-mut">
                {MAP_TYPES[node.kind].label} #{node.id} ·{" "}
                {node.coordinates.status === "valid"
                  ? coordinateText(node.coordinates)
                  : node.coordinates.reason}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn text-xs"
                onClick={() => onSelect(node.key, true)}
                aria-label={`Detail ${MAP_TYPES[node.kind].label} #${node.id}`}
              >
                Detail
              </button>
              {canWrite && (
                <button
                  className="btn text-xs"
                  onClick={() => onEdit(node)}
                  aria-label={`Atur koordinat ${MAP_TYPES[node.kind].label} #${node.id}`}
                >
                  <Pencil size={12} /> GPS
                </button>
              )}
              <Link className="btn text-xs" to={node.link}>
                Buka {MAP_TYPES[node.kind].label}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-mut">
        <span>
          {current * size + 1}–{Math.min((current + 1) * size, nodes.length)}{" "}
          dari {nodes.length} perangkat
        </span>
        {last > 0 && (
          <div className="flex gap-2">
            <button
              className="btn text-xs"
              disabled={!current}
              aria-label={`Halaman sebelumnya ${name}`}
              onClick={() => setPage(current - 1)}
            >
              Sebelumnya
            </button>
            <button
              className="btn text-xs"
              disabled={current === last}
              aria-label={`Halaman berikutnya ${name}`}
              onClick={() => setPage(current + 1)}
            >
              Berikutnya
            </button>
          </div>
        )}
      </div>
    </>
  );
}
function Detail({ node, model, onEdit, onSelect, canWrite }) {
  if (!node)
    return (
      <Card>
        <h2 className="mb-2 text-sm font-semibold">Detail perangkat</h2>
        <p className="text-xs text-mut">
          Klik ikon/grup pada peta atau tombol Detail pada daftar. Perangkat
          yang belum dipetakan sumbernya tetap tampil jika memiliki koordinat
          valid.
        </p>
      </Card>
    );
  const edges = model.connections.filter(
    (e) => e.from.key === node.key || e.to.key === node.key,
  );
  return (
    <section
      data-selected-device={node.key}
      aria-label="Detail perangkat terpilih"
    >
      <Card className="space-y-3 break-words">
        <div>
          <p className="text-xs text-mut">
            {MAP_TYPES[node.kind].label} #{node.id}
          </p>
          <h2 className="font-semibold">{node.name}</h2>
        </div>
        <dl className="space-y-2 text-xs">
          <div>
            <dt className="text-mut">Koordinat WGS84 (latitude, longitude)</dt>
            <dd>
              {node.coordinates.status === "valid"
                ? coordinateText(node.coordinates)
                : node.coordinates.reason}
            </dd>
          </div>
          {node.coordinates.status === "valid" && (
            <div>
              <dt className="text-mut">Sumber koordinat</dt>
              <dd>
                {node.coordinates.source === "manual"
                  ? "GPS terpisah"
                  : "Dibaca dari Lokasi lama"}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-mut">Lokasi / alamat asli</dt>
            <dd className="whitespace-pre-wrap">
              {node.location || "Belum diisi"}
            </dd>
          </div>
          <div>
            <dt className="text-mut">
              OLT induk inventaris (bukan bukti sumber)
            </dt>
            <dd>{node.oltName}</dd>
          </div>
          {node.odcName && (
            <div>
              <dt className="text-mut">ODC induk inventaris</dt>
              <dd>{node.odcName}</dd>
            </div>
          )}
          {node.notes && (
            <div>
              <dt className="text-mut">Catatan</dt>
              <dd className="whitespace-pre-wrap">{node.notes}</dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn text-xs"
            disabled={node.coordinates.status !== "valid"}
            onClick={() => onSelect(node.key)}
          >
            <LocateFixed size={13} /> Fokus titik
          </button>
          {canWrite && (
            <button className="btn text-xs" onClick={() => onEdit(node)}>
              <Pencil size={12} /> Atur GPS
            </button>
          )}
          <Link className="btn text-xs" to={node.link}>
            Buka {MAP_TYPES[node.kind].label}
          </Link>
        </div>
        <div className="border-t border-line pt-3 text-xs">
          <h3 className="mb-2 font-semibold">
            Hubungan antarlokasi tercatat ({edges.length})
          </h3>
          {!edges.length && (
            <p className="text-mut">
              Belum ada koneksi antarlokasi tercatat. Sumber fisik tidak ditebak
              dari induk inventaris.
            </p>
          )}
          {edges.map((edge) => (
            <details
              key={edge.key}
              className="mb-2 rounded-lg border border-line p-2"
            >
              <summary className="cursor-pointer">
                {edge.from.name} → {edge.to.name}
                {edge.review ? " · cek receiver" : ""}
              </summary>
              <ul className="mt-2 list-inside list-disc space-y-1 text-mut">
                {edge.evidence.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              {!edge.drawable && (
                <p className="mt-2 text-amber-400">
                  Belum bisa digambar: salah satu perangkat belum memiliki
                  koordinat.
                </p>
              )}
            </details>
          ))}
          <p className="mt-3 text-mut">
            {SCHEMATIC_NOTICE} Untuk penelusuran sumber interface, gunakan{" "}
            <Link className="text-acc underline" to="/">
              Alur Core
            </Link>{" "}
            /{" "}
            <Link className="text-acc underline" to="/mapping">
              Mapping Core
            </Link>
            .
          </p>
        </div>
      </Card>
    </section>
  );
}

export default function Peta({ MapCanvasComponent = Canvas }) {
  const { user } = useAuth(),
    canWrite = user?.role === "admin" || user?.role === "operator";
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [loadedAt, setLoadedAt] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS),
    [showConnections, setShowConnections] = useState(true),
    [basemap, setBasemap] = useState(false);
  const [selected, setSelected] = useState(null),
    [focus, setFocus] = useState(null),
    [fitRevision, setFitRevision] = useState(0);
  const [edit, setEdit] = useState(null),
    [gpsForm, setGpsForm] = useState({}),
    [saving, setSaving] = useState(false),
    [exporting, setExporting] = useState(false);
  const [toastState, setToastState] = useState(null),
    toast = useToast(setToastState);
  const mapSection = useRef(null);
  const mounted = useRef(true),
    generation = useRef(0),
    saveBusy = useRef(false),
    exportBusy = useRef(false);
  const load = useCallback(async () => {
    if (!mounted.current) return false;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    setData(null);
    setLoadedAt(null);
    try {
      const snapshot = validateSnapshot(await api("/api/map-data"));
      if (!mounted.current || request !== generation.current) return false;
      setData(snapshot);
      setLoadedAt(new Date().toISOString());
      return true;
    } catch (e) {
      if (mounted.current && request === generation.current)
        setError(e.message);
      return false;
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [load]);
  const model = useMemo(() => buildNetworkMap(data || {}), [data]);
  const full = useMemo(() => filterNetworkMap(model), [model]);
  const view = useMemo(
    () => filterNetworkMap(model, filters),
    [model, filters],
  );
  const hasFilters = Object.values(filters).some((value) =>
    String(value).trim(),
  );
  useEffect(() => {
    if (
      data &&
      !loading &&
      selected &&
      !view.nodes.some((n) => n.key === selected)
    ) {
      setSelected(null);
      setFocus(null);
    }
  }, [view, selected, data, loading]);
  const select = useCallback((key, reveal = false) => {
    setSelected(key);
    setFocus({ key, revision: Date.now() });
    if (reveal)
      mapSection.current?.scrollIntoView?.({
        block: "start",
        behavior: "auto",
      });
  }, []);
  function editGps(node) {
    if (!canWrite || saveBusy.current) return;
    setEdit(node);
    setGpsForm({ ...coordinateForm(node.record), location: node.location });
  }
  async function saveGps(event) {
    event.preventDefault();
    if (!edit || !canWrite || saveBusy.current) return;
    saveBusy.current = true;
    setSaving(true);
    try {
      await api(`/api/${edit.kind}s/${edit.id}`, {
        method: "PATCH",
        body: {
          coordinate_mode: gpsForm.coordinate_mode,
          latitude: gpsForm.latitude,
          longitude: gpsForm.longitude,
        },
      });
      if (!mounted.current) return;
      setEdit(null);
      const refreshed = await load();
      if (mounted.current)
        toast(
          refreshed
            ? "GPS tersimpan; titik dan KMZ telah diperbarui."
            : "GPS tersimpan, tetapi snapshot peta gagal dimuat. Muat ulang sebelum ekspor.",
          refreshed ? "success" : "error",
        );
    } catch (e) {
      if (mounted.current) toast(e.message, "error");
    } finally {
      saveBusy.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  async function exportMap(filtered) {
    const snapshot = filtered ? view : full;
    if (
      !data ||
      loading ||
      error ||
      !snapshot.points.length ||
      exportBusy.current ||
      saveBusy.current
    )
      return;
    exportBusy.current = true;
    setExporting(true);
    const session = getSessionVersion(),
      isCurrent = () => mounted.current && session === getSessionVersion();
    try {
      const { downloadKmz } = await import("../lib/kmz-download.js");
      if (!isCurrent()) return;
      const scope = filtered
        ? `terfilter · OLT induk: ${filters.oltId ? data.olts.find((o) => String(o.id) === String(filters.oltId))?.name : "semua"}; ODC induk: ${filters.odcId ? data.odcs.find((d) => String(d.id) === String(filters.odcId))?.name : "semua"}; jenis: ${filters.kind || "semua"}; pencarian: ${filters.query || "—"}`
        : "lengkap";
      await downloadKmz(
        snapshot,
        { scope, includeConnections: showConnections, exportedAt: loadedAt },
        { isCurrent },
      );
      if (isCurrent())
        toast(
          `KMZ ${filtered ? "terfilter" : "lengkap"} dibuat: ${snapshot.points.length} titik. Buka berkas .kmz di Google Earth.`,
        );
    } catch (e) {
      if (isCurrent()) toast(`Ekspor KMZ gagal: ${e.message}`, "error");
    } finally {
      exportBusy.current = false;
      if (mounted.current) setExporting(false);
    }
  }
  const controlsBusy = loading || saving || exporting;
  return (
    <>
      <PageHeader
        title="Peta Jaringan / KMZ"
        desc="Semua OLT, ODC, dan ODP berkoordinat dalam satu peta."
      >
        <button
          className="btn text-xs"
          disabled={controlsBusy || !data}
          onClick={() => {
            setFilters(EMPTY_FILTERS);
            setSelected(null);
            setFocus(null);
            setFitRevision((v) => v + 1);
          }}
        >
          <LocateFixed size={14} /> Tampilkan Semua Titik
        </button>
        <button className="btn text-xs" disabled={controlsBusy} onClick={load}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Muat
          ulang peta
        </button>
      </PageHeader>
      <Toast toast={toastState} />
      {loading && (
        <Card>
          <p role="status">Memuat snapshot titik dan bukti koneksi…</p>
        </Card>
      )}
      {error && (
        <Card className="border-red-400/40">
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
          <button className="btn mt-3" onClick={load}>
            Coba lagi
          </button>
        </Card>
      )}
      {data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(MAP_TYPES).map(([kind, type]) => (
              <Card key={kind}>
                <div className="flex items-center gap-2 text-xs text-mut">
                  <MapPin size={14} style={{ color: type.color }} />
                  {type.label} · seluruh inventaris
                </div>
                <div className="mt-2 text-2xl font-semibold">
                  {full.points.filter((n) => n.kind === kind).length}
                  <span className="ml-2 text-xs font-normal text-mut">
                    / {model.nodes.filter((n) => n.kind === kind).length}{" "}
                    perangkat memiliki titik
                  </span>
                </div>
              </Card>
            ))}
          </div>
          <Card>
            <fieldset disabled={controlsBusy} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="OLT induk inventaris">
                  <select
                    className="input"
                    value={filters.oltId}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        oltId: e.target.value,
                        odcId: "",
                      })
                    }
                  >
                    <option value="">Semua OLT</option>
                    {data.olts.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ODC induk inventaris">
                  <select
                    className="input"
                    value={filters.odcId}
                    onChange={(e) =>
                      setFilters({ ...filters, odcId: e.target.value })
                    }
                  >
                    <option value="">Semua ODC</option>
                    {data.odcs
                      .filter(
                        (d) =>
                          !filters.oltId ||
                          String(d.olt_id) === String(filters.oltId),
                      )
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Jenis perangkat">
                  <select
                    className="input"
                    value={filters.kind}
                    onChange={(e) =>
                      setFilters({ ...filters, kind: e.target.value })
                    }
                  >
                    <option value="">Semua jenis</option>
                    {Object.entries(MAP_TYPES).map(([kind, type]) => (
                      <option key={kind} value={kind}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="self-end">
                  <SearchBox
                    value={filters.query}
                    onChange={(query) => setFilters({ ...filters, query })}
                    placeholder="Cari nama, lokasi, atau induk…"
                  />
                </div>
              </div>
              <p className="text-xs text-mut">
                Filter induk mengikuti inventaris, bukan bukti sumber fisik OLT.
                Titik tanpa pemetaan sumber tetap ditampilkan. Garis yang salah
                satu ujungnya di luar filter tidak ditarik.
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showConnections}
                    onChange={(e) => setShowConnections(e.target.checked)}
                  />{" "}
                  Koneksi skematis pada peta dan KMZ
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={basemap}
                    onChange={(e) => setBasemap(e.target.checked)}
                  />{" "}
                  Aktifkan peta dasar OpenStreetMap (internet)
                </label>
              </div>
              <p className="text-[11px] text-mut">
                Peta dasar opsional; saat diaktifkan, penyedia OpenStreetMap
                dapat melihat IP, asal situs, dan area tampilan. Titik/KMZ tidak
                memerlukan layanan peta luar.
              </p>
            </fieldset>
          </Card>
          <div
            ref={mapSection}
            className="grid scroll-mt-16 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]"
          >
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mut">
                <span data-map-summary>
                  {view.points.length} titik valid · {view.missing.length} belum
                  ada koordinat · {showConnections ? view.lines.length : 0}{" "}
                  garis terlihat
                </span>
                <span>
                  Data dibaca: {new Date(loadedAt).toLocaleString("id-ID")}
                </span>
              </div>
              <MapBoundary>
                <Suspense
                  fallback={
                    <Card>
                      <p role="status">Memuat komponen peta…</p>
                    </Card>
                  }
                >
                  <MapCanvasComponent
                    points={view.points}
                    lines={view.lines}
                    focus={focus}
                    fitRevision={fitRevision}
                    showConnections={showConnections}
                    basemap={basemap}
                    onSelect={select}
                  />
                </Suspense>
              </MapBoundary>
              <div className="flex flex-wrap gap-4 text-xs text-mut">
                {Object.entries(MAP_TYPES).map(([kind, type]) => (
                  <span key={kind} className="flex items-center gap-1">
                    <span
                      style={{ background: type.color }}
                      className={`inline-block h-3 w-3 ${kind === "olt" ? "rounded-full" : kind === "odc" ? "rounded-sm" : "rotate-45"}`}
                    />
                    {type.label}
                  </span>
                ))}
                <span>
                  Angka pada grup = jumlah perangkat; klik/perbesar untuk
                  memisahkan ikon yang berdempet.
                </span>
              </div>
              <p className="text-xs text-amber-400">{SCHEMATIC_NOTICE}</p>
              <p className="text-[11px] text-mut">
                Satu garis merangkum pasangan perangkat; seluruh bukti port,
                core, splitter/receiver, dan output tetap tersedia pada detail.
              </p>
              {(view.unpositionedConnections > 0 ||
                view.hiddenConnections > 0) && (
                <p className="text-xs text-mut">
                  {view.unpositionedConnections} koneksi belum dapat digambar
                  karena GPS belum lengkap; {view.hiddenConnections} koneksi
                  melewati batas filter.
                </p>
              )}
            </div>
            <Detail
              node={model.byKey.get(selected)}
              model={model}
              canWrite={canWrite}
              onEdit={editGps}
              onSelect={select}
            />
          </div>
          <Card>
            <h2 className="mb-2 text-sm font-semibold">
              Unduh KMZ untuk Google Earth
            </h2>
            <p className="mb-3 text-xs text-mut">
              KMZ lengkap selalu memuat seluruh {full.points.length} titik
              valid, meskipun peta sedang difilter. Berkas berisi folder OLT,
              ODC, ODP, ikon lokal, serta koneksi skematis bila dicentang.
              Perangkat tanpa GPS dicatat tanpa geometri, bukan ditempatkan di
              0,0.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-primary"
                disabled={controlsBusy || !full.points.length}
                onClick={() => exportMap(false)}
              >
                <Download size={14} />
                {exporting
                  ? "Menyiapkan KMZ…"
                  : `Unduh KMZ Lengkap (${full.points.length} titik)`}
              </button>
              <button
                className="btn"
                disabled={controlsBusy || !hasFilters || !view.points.length}
                onClick={() => exportMap(true)}
              >
                <Download size={14} /> Unduh KMZ Terfilter ({view.points.length}{" "}
                titik)
              </button>
            </div>
            {!full.points.length && (
              <p className="mt-2 text-xs text-amber-400">
                Belum ada GPS valid untuk diekspor. Isi koordinat perangkat yang
                sebenarnya terlebih dahulu; aplikasi tidak menambahkan contoh
                GPS ke inventaris.
              </p>
            )}
            <p className="mt-3 text-[11px] text-mut">
              Ini berkas geografis interaktif, bukan tangkapan layar. Nama,
              lokasi, dan catatan inventaris ikut diekspor: simpan/bagikan KMZ
              sebagai data jaringan privat. Tidak memuat akun, sesi, atau alamat
              IP manajemen OLT.
            </p>
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-semibold">
              Belum ada koordinat ({view.missing.length})
            </h2>
            <p className="mb-2 text-xs text-mut">
              Termasuk GPS tidak valid atau titik yang sengaja dinonaktifkan.
              Tidak ada geocoding, pertukaran latitude/longitude, atau titik
              default otomatis.
            </p>
            <DeviceList
              nodes={view.missing}
              name="belum ada koordinat"
              onSelect={select}
              onEdit={editGps}
              canWrite={canWrite}
            />
          </Card>
          <Card>
            <details>
              <summary className="cursor-pointer text-sm font-semibold">
                Daftar titik valid ({view.points.length})
              </summary>
              <DeviceList
                nodes={view.points}
                name="titik valid"
                onSelect={select}
                onEdit={editGps}
                canWrite={canWrite}
              />
            </details>
          </Card>
          {(model.issues.length > 0 ||
            model.connections.some((e) => e.review)) && (
            <Card>
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-amber-400">
                  Catatan pemeriksaan sambungan · seluruh inventaris
                </summary>
                <p className="mt-2 text-xs text-mut">
                  Receiver perlu verifikasi:{" "}
                  {model.connections.filter((e) => e.review).length} koneksi
                  kabinet. Gunakan Mapping Core untuk memverifikasi. Bukti
                  sumber yang konflik/tidak lengkap tidak diganti dengan
                  tebakan.
                </p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-mut">
                  {model.issues.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </details>
            </Card>
          )}
        </div>
      )}
      <Modal
        open={!!edit}
        busy={saving}
        title={`Atur GPS · ${edit?.name || "perangkat"}`}
        onClose={() => {
          if (!saveBusy.current) setEdit(null);
        }}
      >
        <form onSubmit={saveGps} className="space-y-3">
          <p className="text-xs text-mut">
            Hanya mengubah GPS{" "}
            {edit && `${MAP_TYPES[edit.kind].label} #${edit.id}`}; nama, alamat,
            induk, dan sambungan tidak ditulis ulang.
          </p>
          {edit && <CoordinateFields form={gpsForm} onChange={setGpsForm} />}
          <button className="btn btn-primary w-full" disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan GPS"}
          </button>
        </form>
      </Modal>
    </>
  );
}
