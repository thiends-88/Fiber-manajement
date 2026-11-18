import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, Cable, CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import { api, getSessionVersion } from "../lib/api.js";
import { buildOdpConnections } from "../lib/odp-connections.js";
import { validateOdpSnapshot } from "../lib/map-snapshot.js";
import { getCableInfo, STATUS } from "../lib/fiber.js";

function CoreChip({ core }) {
  return <span className="inline-flex flex-wrap items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs">
    <span className="size-2.5 shrink-0 rounded-full ring-1 ring-white/30" style={{ background: core.hex }} aria-hidden="true" />
    Core {core.number} · {core.color} · Tube {core.tube}
  </span>;
}
const labels = { olt: "OLT asal", interface: "Interface OLT", odc: "ODC", splitter: "Splitter", odp: "ODP", direct: "Jenis sambungan" };
function Route({ route, index }) {
  const mapped = route.status === "mapped";
  return <details open={index === 0} className="rounded-xl border border-line bg-panel2 p-3" data-odp-route={route.status}>
    <summary className="cursor-pointer text-sm font-semibold">
      Jalur {index + 1} <span className={`ml-2 inline-flex items-center gap-1 text-xs font-normal ${mapped ? "text-emerald-400" : "text-amber-400"}`}>
        {mapped ? <CheckCircle2 size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
        {mapped ? "Asal terpetakan" : route.status === "review" ? "Perlu verifikasi" : "Hulu belum lengkap"}
      </span>
    </summary>
    {!mapped && <p className="mt-2 text-xs text-amber-400">Jalur ini belum dapat dianggap sebagai asal interface yang terkonfirmasi.</p>}
    <ol className="mt-3 space-y-2" aria-label={`Urutan sambungan jalur ${index + 1}`}>
      {route.steps.map((step, i) => <li key={`${step.kind}-${step.id}-${i}`} className="min-w-0">
        {i > 0 && <ArrowDown className="mb-2 ml-3 text-mut" size={13} aria-hidden="true" />}
        <div className="rounded-lg border border-line bg-panel p-3">
          <p className="text-[11px] text-mut">{labels[step.kind]}</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words text-sm font-semibold">{step.label}{step.ratio ? ` (${step.ratio})` : ""}</span>
            {step.output != null && <span className="badge bg-emerald-500/10 text-emerald-400">Output {step.output}</span>}
          </div>
          {step.detail && <p className="mt-1 break-words text-xs text-mut">{step.detail}</p>}
          {step.core && <div className="mt-2"><CoreChip core={step.core} /></div>}
        </div>
      </li>)}
    </ol>
    <ul className="mt-3 space-y-1 text-xs text-amber-400">{[...new Set(route.issues)].map(issue => <li key={issue}>{issue}</li>)}</ul>
  </details>;
}

export default function OdpConnectionDetail({ odpId }) {
  const [state, setState] = useState({ loading: true }), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const session = getSessionVersion();
    setState({ loading: true });
    api(`/api/map-data?odp_id=${encodeURIComponent(odpId)}`).then(value => {
      const snapshot = validateOdpSnapshot(value, odpId);
      const detail = buildOdpConnections({ ...snapshot, cores: snapshot.odpDetail.cores }, odpId);
      if (active && session === getSessionVersion()) setState({ detail, readAt: snapshot.odpDetail.readAt });
    }).catch(error => {
      if (active && session === getSessionVersion()) setState({ error: error.message });
    });
    return () => { active = false; };
  }, [odpId, revision]);
  function reload() { setState({ loading: true }); setRevision(n => n + 1); }
  if (state.loading) return <p role="status" className="py-6 text-sm text-mut">Menelusuri asal sambungan dan core power ODP…</p>;
  if (state.error) return <div role="alert" className="space-y-3 text-sm"><p className="text-red-400">{state.error}</p><button className="btn" onClick={reload}>Coba lagi detail</button></div>;
  const { detail, readAt } = state, { odp } = detail;
  const origins = detail.routes.filter(r => r.status === "mapped");
  const usedCores = detail.powerCores.filter(c => c.usages.length || c.records.some(r => r.status === "used"));
  return <div className="min-w-0 space-y-5 break-words" data-odp-connection-detail={odp.id}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-mut">Rincian sambungan tercatat · baca-saja</p>
        <h3 className="mt-1 break-words text-lg font-semibold">{odp.name}</h3>
        <p className="mt-1 break-words text-xs text-mut">{odp.location || "Alamat belum diisi"}</p>
      </div>
      <button className="btn shrink-0 self-start text-xs" onClick={reload}><RefreshCw size={13} /> Muat ulang detail</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2" aria-label="Ringkasan sambungan ODP">
      <div className="min-w-0 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
        <h3 className="font-semibold">OLT / interface asal terpetakan</h3>
        {!origins.length && <p className="mt-2 text-amber-400">Belum dapat dikonfirmasi. Periksa rincian jalur di bawah.</p>}
        {origins.slice(0, 3).map((route, i) => <div key={route.key} className="mt-2 space-y-1">
          <p className="text-mut">Jalur {i + 1}</p>
          <p className="font-semibold">{route.olt.name} · {route.port.interface_label}</p>
          <p className="text-mut">Lewat {route.steps.filter(s => s.kind === "odc").map(s => s.label).join(" → ")}</p>
          {route.steps.find(s => s.kind === "odc")?.core && <CoreChip core={route.steps.find(s => s.kind === "odc").core} />}
        </div>)}
        {origins.length > 3 && <p className="mt-2 text-mut">+{origins.length - 3} jalur terpetakan lain; lihat rincian di bawah.</p>}
        {origins.length > 0 && detail.routes.some(r => r.status !== "mapped") && <p className="mt-2 text-amber-400">Ada jalur lain yang hulu/receivernya belum lengkap atau perlu verifikasi. Tidak digabung ke sumber di atas.</p>}
      </div>
      <div className="min-w-0 rounded-xl border border-line bg-panel2 p-3 text-xs">
        <h3 className="font-semibold">Core power terpakai / terdeteksi</h3>
        {!usedCores.length && <p className="mt-2 text-mut">Belum ada core berstatus terpakai atau pemakaian yang terdeteksi.</p>}
        <div className="mt-2 flex flex-wrap gap-2">{usedCores.slice(0, 6).map(core => <CoreChip key={core.number} core={core} />)}</div>
        {usedCores.length > 6 && <p className="mt-2 text-mut">+{usedCores.length - 6} core lain; lihat daftar di bawah.</p>}
        <p className="mt-2 text-mut">Core kabel ODP sendiri. Status manual, cadangan/rusak, tujuan dan catatan ada di bagian Core power ODP.</p>
      </div>
    </div>
    <section aria-label="Asal sambungan ODP" className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Cable size={15} aria-hidden="true" /> Asal sambungan ODP</h3>
      {!detail.routes.length && <p className="rounded-lg border border-dashed border-line p-3 text-sm text-mut">Belum ada sambungan menuju ODP ini. OLT/interface asal belum diketahui; catat sambungannya di Mapping Core.</p>}
      {detail.routes.map((route, index) => <Route key={route.key} route={route} index={index} />)}
      {detail.truncated && <p role="note" className="text-xs text-amber-400">Penelusuran dibatasi agar peta tetap ringan. Ada jalur berulang/terlalu banyak; periksa keseluruhannya di Mapping Core.</p>}
      {detail.routes.some(route => route.steps.at(-1)?.kind === "odp" && !route.steps.at(-1)?.core) && <p className="text-xs text-mut">Output splitter menuju ODP tidak mencatat nomor core masuk ODP. Nomor itu tidak disamakan otomatis dengan core feeder atau core power di bawah.</p>}
    </section>
    <section aria-label="Core power ODP" className="space-y-3 border-t border-line pt-4">
      <div><h3 className="text-sm font-semibold">Core power ODP — kabel ODP sendiri</h3><p className="mt-1 text-xs text-mut">{getCableInfo(odp.cable_type)?.label || "Tipe kabel belum dikenali"}. Core power adalah penandaan core, bukan pengukuran dBm atau perhitungan redaman.</p></div>
      {!detail.powerCores.length && <p className="text-sm text-mut">Belum ada core power yang dicatat atau pemakaian core yang dapat dideteksi.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {detail.powerCores.map(core => <li key={core.number} className="min-w-0 rounded-xl border border-line bg-panel2 p-3" data-odp-power-core={core.number}>
          <CoreChip core={core} />
          {core.records.map((record, i) => <div key={i} className="mt-2 space-y-1 text-xs">
            <p>Status tersimpan: <span className={`badge ${STATUS[record.status]?.cls || ""}`}>{STATUS[record.status]?.label || "Tidak dikenal"}</span></p>
            {record.destination && <p>Tujuan: {record.destination}</p>}
            {record.notes && <p className="whitespace-pre-wrap text-mut">Catatan: {record.notes}</p>}
          </div>)}
          {!core.records.length && <p className="mt-2 text-xs text-mut">Status manual belum dicatat.</p>}
          {core.usages.length > 0 && <div className="mt-2 text-xs"><p className="font-medium text-emerald-400">Terpakai terdeteksi dari sambungan:</p><ul className="mt-1 space-y-1 text-mut">{[...new Set(core.usages)].map(use => <li key={use}>{use}</li>)}</ul></div>}
        </li>)}
      </ul>
      {detail.warnings.map(warning => <p key={warning} className="text-xs text-amber-400">{warning}</p>)}
    </section>
    {detail.localSplitters.length > 0 && <section aria-label="Splitter di dalam ODP" className="space-y-2 border-t border-line pt-4">
      <h3 className="text-sm font-semibold">Splitter di dalam ODP</h3>
      {detail.localSplitters.map(s => <p key={s.id} className="text-xs text-mut">{s.name} ({s.ratio}) · input core {s.input_core ?? "belum diisi"}</p>)}
    </section>}
    <details className="rounded-xl border border-line p-3 text-xs">
      <summary className="cursor-pointer font-semibold">Induk inventaris — bukan bukti asal fisik</summary>
      <p className="mt-2">{detail.inventoryOlt?.name || "OLT induk belum diketahui"} → {detail.inventoryOdc?.name || "ODC induk belum diketahui"} → {odp.name}</p>
      <p className="mt-2 text-mut">Asal interface hanya mengikuti mapping core, kabel langsung, dan receiver/output splitter yang tersimpan. Tidak ditebak dari induk, koordinat, atau warna core.</p>
    </details>
    <div className="flex flex-wrap gap-2 border-t border-line pt-4">
      <Link className="btn btn-primary text-xs" to={`/odp?odp=${encodeURIComponent(odp.id)}`}>Buka input ODP</Link>
      <Link className="btn text-xs" to="/mapping">Buka Mapping Core</Link>
    </div>
    <p className="text-[11px] text-mut">{readAt && `Snapshot dibaca: ${new Date(readAt).toLocaleString("id-ID")}. `}Membuka detail tidak mengubah akun, inventaris, core, atau mapping.</p>
  </div>;
}
