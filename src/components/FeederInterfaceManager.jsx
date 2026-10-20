import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { directInputSplitters, feederInputUsage } from "../lib/interface-routes.js";
import { interfaceLabel } from "../lib/interfaces.js";
import { getCableInfo } from "../lib/fiber.js";
import { Card, Empty, Field, Modal, Toast, useToast } from "./ui.jsx";
import { CoreChip } from "./JalurCore.jsx";
import InterfaceBadge from "./InterfaceBadge.jsx";

export default function FeederInterfaceManager({ odcId, cableType, onChanged, reloadKey }) {
  const { user } = useAuth();
  const canWrite = ["admin", "operator"].includes(user.role);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ core: "", port_id: "", notes: "" });
  const request = useRef(0), busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);
  const total = getCableInfo(cableType)?.cores || 0;
  const load = useCallback(async () => {
    const version = ++request.current;
    setError("");
    const [feeders, mappings, splitters, links] = await Promise.all([
      api(`/api/feeder-ports?odc_id=${odcId}`), api("/api/interface-mappings"), api("/api/splitters"), api(`/api/links?odc_id=${odcId}`),
    ]);
    if (version === request.current) setData({ feeders, mappings, splitters, links });
  }, [odcId]);
  useEffect(() => {
    setData(null); setModal(null);
    let active = true;
    // Each parent gets a new component key at call sites, so an older response
    // cannot replace the current cabinet's mapping.
    load().catch((e) => { if (active) setError(e.message); });
    return () => { active = false; request.current++; };
  }, [load, reloadKey]);

  if (error) return <Card><p className="mb-2 text-xs text-red-400" role="alert">Mapping interface gagal dimuat: {error}</p><button className="btn" onClick={() => load().catch((e) => setError(e.message))}>Coba lagi</button></Card>;
  if (!data) return <Card><p className="text-xs text-mut">Memuat mapping interface feeder…</p></Card>;

  const mine = data.mappings.filter((m) => Number(m.odc_id) === Number(odcId));
  const used = new Set(directInputSplitters(data.splitters).filter((s) => Number(s.odc_id) === Number(odcId) && s.input_core != null).map((s) => Number(s.input_core)));
  data.links.forEach((l) => used.add(Number(l.odc_core)));
  const rows = [...new Set([...used, ...mine.map((m) => Number(m.core))])].sort((a, b) => a - b);
  const usage = feederInputUsage(data);
  const conflict = (core) => (usage.get(`${Number(odcId)}:${Number(core)}`) || 0) > 1;
  const mappedCount = mine.filter((m) => m.port_id && !conflict(m.core)).length;
  const selectedPort = data.feeders.find((f) => Number(f.port_id) === Number(form.port_id));

  function open(core = "") {
    const mapping = mine.find((m) => Number(m.core) === Number(core));
    setForm({ core, port_id: mapping?.port_id || "", notes: mapping?.notes || "" });
    setModal({ fixedCore: !!core });
  }
  async function save(e) {
    e.preventDefault();
    if (busy.current) return;
    const old = mine.find((m) => Number(m.core) === Number(form.core));
    if (old?.port_id && Number(old.port_id) !== Number(form.port_id)
        && !confirm(`Ganti sumber core ${form.core} dari ${interfaceLabel(old)} ke ${interfaceLabel(selectedPort)}? Pastikan sesuai sambungan fisik.`)) return;
    busy.current = true; setSaving(true);
    try {
      await api("/api/interface-mappings", { method: "PUT", body: { odc_id: Number(odcId), core: Number(form.core), port_id: Number(form.port_id), notes: form.notes } });
      setModal(null);
      await load();
      await onChanged?.();
      toast("Interface → core feeder tersimpan");
    } catch (e) { toast(e.message, "error"); }
    finally { busy.current = false; setSaving(false); }
  }
  async function remove(mapping) {
    if (busy.current || !confirm(`Lepaskan ${interfaceLabel(mapping)} dari core ${mapping.core}? Sambungan splitter/ODP tetap ada, tetapi interface asal akan ditandai belum dipetakan.`)) return;
    busy.current = true; setSaving(true);
    try {
      await api(`/api/interface-mappings/${mapping.id}`, { method: "DELETE" });
      await load();
      await onChanged?.();
      toast("Mapping dilepas; sambungan hilir tetap dipertahankan");
    } catch (e) { toast(e.message, "error"); }
    finally { busy.current = false; setSaving(false); }
  }

  return <Card>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Interface OLT → Core Feeder</h2>
      <div className="flex gap-2"><button className="btn px-2 text-xs" title="Muat ulang mapping interface" disabled={saving} onClick={() => load().catch((e) => setError(e.message))}><RefreshCw size={13} /></button>{canWrite && <button className="btn text-xs" onClick={() => open()} disabled={saving || !data.feeders.length}><Plus size={13} /> Petakan interface</button>}</div>
    </div>
    <p className="text-xs text-mut">Catat core kabel yang benar-benar menerima port OLT. Satu port fisik masuk satu core feeder langsung; percabangan berikutnya dicatat melalui splitter.</p>
    <p className="mt-1 text-xs text-mut">{mappedCount} core sudah dipetakan · {rows.filter((n) => conflict(n) || !mine.some((m) => Number(m.core) === n && m.port_id)).length} core berjalur belum dipetakan. Jalur dari ODC induk mengikuti output splitter induknya, bukan dipetakan ulang ke port OLT.</p>
    {!data.feeders.length && <div className="mt-3 rounded-lg border border-amber-500/30 p-3 text-xs text-mut">Belum ada interface feeder langsung untuk ODC ini. Jika kabel datang dari OLT, pilih port-nya di <Link className="text-acc underline" to={`/odc?odc=${odcId}&edit=1`}>Edit ODC</Link>. Jika dari ODC induk, arahkan output splitter induk ke splitter penerima di ODC ini.</div>}
    {rows.length ? <div className="mt-3 overflow-x-auto"><table className="w-full">
      <thead><tr className="border-b border-line"><th className="th">Core kabel masuk</th><th className="th">Interface sumber</th><th className="th">Catatan lapangan</th>{canWrite && <th className="th">Aksi</th>}</tr></thead>
      <tbody>{rows.map((core) => {
        const mapping = mine.find((m) => Number(m.core) === core);
        const ambiguous = conflict(core);
        return <tr key={core} className="border-b border-line-soft last:border-0">
          <td className="td"><CoreChip core={core} cableType={cableType} small />{!used.has(core) && <div className="mt-1 text-[10px] text-mut">Sambungan hilir belum dicatat</div>}</td>
          <td className="td"><InterfaceBadge port={mapping?.port_id && !ambiguous ? mapping : null} link />{ambiguous && <div className="mt-1 max-w-xs text-[11px] text-amber-300">Input core ganda. Periksa sambungan splitter/kabel langsung sebelum menentukan sumber.{mapping?.port_id ? ` Mapping tercatat: ${interfaceLabel(mapping)}.` : ""}</div>}{mapping?.port_id && <div className="mt-1 text-[10px] text-mut">{mapping.olt_name}</div>}</td>
          <td className="td text-xs text-mut">{mapping?.notes || "—"}</td>
          {canWrite && <td className="td"><div className="flex gap-2"><button className="btn px-2 py-1 text-xs" disabled={!data.feeders.length || saving} onClick={() => open(core)}><Pencil size={12} />{mapping?.port_id ? "Ubah" : "Atur"}</button>{mapping && <button className="btn px-2 py-1 text-red-400" title={`Lepaskan mapping core ${core}`} disabled={saving} onClick={() => remove(mapping)}><Trash2 size={12} /></button>}</div></td>}
        </tr>;
      })}</tbody>
    </table></div> : <div className="mt-3"><Empty text="Belum ada core berjalur. Anda bisa memetakan interface ke core terlebih dahulu, lalu menghubungkannya ke splitter atau ODP." /></div>}

    <Modal open={!!modal} title="Petakan interface OLT ke core feeder" onClose={() => { if (!saving) setModal(null); }}>
      <form className="space-y-3" onSubmit={save}>
        <Field label="Core kabel feeder ODC"><select aria-label="Core kabel feeder ODC" className="input" required value={form.core} disabled={modal?.fixedCore || saving} onChange={(e) => setForm({ ...form, core: e.target.value })}>
          <option value="" disabled>Pilih core sesuai kabel fisik…</option>
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => <option key={n} value={n} disabled={!modal?.fixedCore && mine.some((m) => Number(m.core) === n)}>Core {n}{mine.some((m) => Number(m.core) === n) ? " — sudah ada mapping (ubah dari tabel)" : ""}</option>)}
        </select></Field>
        <Field label="Interface sumber dari OLT"><select aria-label="Interface sumber dari OLT" className="input" required value={form.port_id} disabled={saving} onChange={(e) => setForm({ ...form, port_id: e.target.value })}>
          <option value="" disabled>Pilih interface feeder…</option>
          {data.feeders.map((f) => {
            const elsewhere = data.mappings.find((m) => Number(m.port_id) === Number(f.port_id) && !(Number(m.odc_id) === Number(odcId) && Number(m.core) === Number(form.core)));
            return <option key={f.port_id} value={f.port_id} disabled={!!elsewhere}>{interfaceLabel(f)}{elsewhere ? ` — dipakai ${elsewhere.odc_name} core ${elsewhere.core}` : ""}</option>;
          })}
        </select></Field>
        {selectedPort && <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs"><span className="font-medium">{selectedPort.olt_name} / {interfaceLabel(selectedPort)}</span><span className="text-mut"> → core {form.core || "?"} ODC ini</span>{selectedPort.interface_cli && <code className="mt-1 block text-mut">{selectedPort.interface_cli}</code>}</div>}
        <Field label="Catatan sambungan lapangan"><textarea className="input" rows={2} maxLength={2000} value={form.notes} disabled={saving} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Mis. ODF tray 2, kabel feeder A, label patchcord…" /></Field>
        <p className="text-[11px] text-mut">Pilih berdasarkan label dan sambungan fisik. Aplikasi tidak membaca konfigurasi OLT secara otomatis.</p>
        <button className="btn btn-primary w-full" disabled={saving}>{saving ? "Menyimpan…" : "Simpan mapping interface"}</button>
      </form>
    </Modal>
    <Toast toast={toastState} />
  </Card>;
}
