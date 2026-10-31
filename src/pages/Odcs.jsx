import CoordinateFields from "../components/CoordinateFields.jsx";
import { coordinateForm } from "../lib/coordinates.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { interfaceLabel } from "../lib/interfaces.js";
import FeederInterfaceManager from "../components/FeederInterfaceManager.jsx";
import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Badge, Card, Empty, Field, Modal, PageHeader, SearchBox, Toast, matchesQuery, useToast } from "../components/ui.jsx";
import CoreManager from "../components/CoreManager.jsx";
import SplitterManager from "../components/SplitterManager.jsx";
import { CABLE_TYPES, getCableInfo } from "../lib/fiber.js";

const empty = { ...coordinateForm(), name: "", olt_id: "", location: "", cable_type: CABLE_TYPES[0].value, feeder_port_ids: [], notes: "" };

export default function Odcs() {
  const { user } = useAuth();
  const canWrite = user.role === "admin" || user.role === "operator";

  const [params, setParams] = useSearchParams();
  const [odcs, setOdcs] = useState([]);
  const [query, setQuery] = useState("");
  const [olts, setOlts] = useState([]);
  const selectedId = Number(params.get("odc")) || null;
  const setSelectedId = (id) => setParams(id ? { odc: String(id) } : {});
  const [modal, setModal] = useState(null);
  const submitBusy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(empty);
  const [ports, setPorts] = useState([]);
  const [feederPorts, setFeederPorts] = useState([]);
  const [splitters, setSplitters] = useState([]);
  const [networkVersion, setNetworkVersion] = useState(0);
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);

  const load = useCallback(async () => {
    const [d, o, p, f, s] = await Promise.all([
      api("/api/odcs"), api("/api/olts"), api("/api/ports"), api("/api/feeder-ports"), api("/api/splitters"),
    ]);
    setOdcs(d);
    setOlts(o);
    setPorts(p);
    setFeederPorts(f);
    setSplitters(s);
  }, []);

  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, [load, toast]);

  const networkChanged = useCallback(async () => {
    await load();
    setNetworkVersion((v) => v + 1);
  }, [load]);

  async function save(e) {
    e.preventDefault();
    if (submitBusy.current) return;
    submitBusy.current = true; setSaving(true);
    try {
      const body = {
        ...form,
        olt_id: Number(form.olt_id),
        feeder_port_ids: form.feeder_port_ids.map(Number),
      };

      if (modal.mode === "add") await api("/api/odcs", { method: "POST", body });
      else await api(`/api/odcs/${modal.odc.id}`, { method: "PATCH", body: { ...modal.odc, ...body } });
      await load();
      setModal(null);
      toast("ODC tersimpan");
    } catch (err) {
      toast(err.message, "error");
    } finally { submitBusy.current = false; setSaving(false); }
  }

  async function remove(odc) {
    if (!confirm(`Hapus ODC "${odc.name}" beserta ODP dan core assignment-nya?`)) return;
    try {
      await api(`/api/odcs/${odc.id}`, { method: "DELETE" });
      if (selectedId === odc.id) setSelectedId(null);
      await load();
      toast("ODC dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  const selected = odcs.find((d) => d.id === selectedId);
  useEffect(() => {
    if (params.get("edit") !== "1" || !selected || !canWrite) return;
    setForm({ ...coordinateForm(selected), name: selected.name, olt_id: selected.olt_id, location: selected.location || "",
      cable_type: selected.cable_type, notes: selected.notes || "",
      feeder_port_ids: feederPorts.filter((f) => f.odc_id === selected.id).map((f) => f.port_id) });
    setModal({ mode: "edit", odc: selected });
    setParams({ odc: String(selected.id) }, { replace: true });
  }, [params, selected, feederPorts, canWrite, setParams]);
  const shownOdcs = odcs.filter((d) =>
    matchesQuery(query, d.name, d.olt_name, d.location, getCableInfo(d.cable_type)?.label ?? d.cable_type, ...feederPorts.filter((f) => f.odc_id === d.id).map(interfaceLabel)),
  );
  const feederOf = (odcId) => feederPorts.filter((f) => f.odc_id === odcId);
  const feederLabel = interfaceLabel;
  const portsForOlt = ports.filter((p) => p.olt_id === Number(form.olt_id));

  // ODC yang disuplai dari output splitter ODC lain = ODC anak
  const parentInfo = new Map();
  splitters.forEach((sp) => {
    if (!sp.odc_id) return;
    (sp.outputs ?? []).forEach((o) => {
      if (o.target_type === "odc" && o.target_odc_id) {
        const routes = parentInfo.get(Number(o.target_odc_id)) ?? [];
        routes.push({
          parentName: sp.odc_name, splitter: sp.name, ratio: sp.ratio, port: o.port,
          targetSplitter: o.target_odc_splitter_name,
          targetCore: o.target_odc_splitter_input_core ?? o.target_odc_core,
        });
        parentInfo.set(Number(o.target_odc_id), routes);
      }
    });
  });

  return (
    <div>
      <PageHeader title="Manajemen ODC" desc="Optical Distribution Cabinet — klik baris untuk mengelola core.">
        {canWrite && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setForm({ ...empty, olt_id: olts[0]?.id ?? "" });
              setModal({ mode: "add" });
            }}
          >
            <Plus size={15} /> Tambah ODC
          </button>
        )}
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Cari ODC (nama, OLT, lokasi, kabel)…"
          className="w-full sm:max-w-xs"
        />
        {query && (
          <span className="text-xs text-mut">{shownOdcs.length} dari {odcs.length} ODC</span>
        )}
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Nama</th>
              <th className="th">Induk OLT</th>
              <th className="th">Kabel</th>
              <th className="th">Interface Feeder OLT</th>
              <th className="th">Lokasi</th>
              <th className="th">Core</th>
              <th className="th">ODP</th>
              {canWrite && <th className="th">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {shownOdcs.map((d) => (
              <tr
                key={d.id}
                className={`cursor-pointer border-b border-line-soft last:border-0 hover:bg-panel2 ${d.id === selectedId ? "bg-panel2" : ""}`}
                onClick={() => setSelectedId(d.id === selectedId ? null : d.id)}
              >
                <td className="td font-medium">
                  <span className="mr-2 inline-block text-emerald-400"><Boxes size={14} /></span>
                  {d.name}
                </td>
                <td className="td text-mut">
                  {d.olt_name}
                  {parentInfo.has(d.id) && (
                    <div className="mt-1">
                      <Badge cls="bg-sky-500/15 text-sky-300">
                        ODC anak · {parentInfo.get(d.id).length} jalur masuk
                      </Badge>
                      <div className="mt-1 space-y-0.5 text-[10px] text-mut-soft">
                        {parentInfo.get(d.id).map((route, i) => (
                          <div key={`${route.splitter}-${route.port}-${i}`}>
                            {route.parentName} · {route.splitter} {route.ratio} out {route.port}
                            {route.targetSplitter ? ` → ${route.targetSplitter}` : route.targetCore != null ? ` → core ${route.targetCore}` : " → splitter belum dipilih"}
                            {route.targetCore != null ? ` (input core ${route.targetCore})` : ""}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </td>
                <td className="td text-mut">{getCableInfo(d.cable_type)?.label ?? d.cable_type}</td>
                <td className="td text-mut">
                  {feederOf(d.id).length === 0 ? "-" : feederOf(d.id).map(feederLabel).join(", ")}
                </td>
                <td className="td text-mut">{d.location || "-"}</td>
                <td className="td">{d.core_count}</td>
                <td className="td">{d.odp_count}</td>
                {canWrite && (
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button
                        className="btn px-2 py-1"
                        title={`Edit ODC ${d.name}`}
                        onClick={() => {
                          setForm({
                            ...coordinateForm(d), name: d.name, olt_id: d.olt_id, location: d.location || "",
                            cable_type: d.cable_type, notes: d.notes || "",
                            feeder_port_ids: feederOf(d.id).map((f) => f.port_id),
                          });
                          setModal({ mode: "edit", odc: d });
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button className="btn px-2 py-1 text-red-400" title={`Hapus ODC ${d.name}`} onClick={() => remove(d)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {shownOdcs.length === 0 && (
              <tr>
                <td className="td py-8 text-center text-mut" colSpan={canWrite ? 8 : 7}>
                  {odcs.length === 0 ? "Belum ada ODC." : `Tidak ada ODC yang cocok dengan "${query}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {selected && <div className="mt-6"><FeederInterfaceManager reloadKey={networkVersion} key={`${selected.id}:${selected.cable_type}:${feederOf(selected.id).map((f) => f.port_id).join(",")}`} odcId={selected.id} cableType={selected.cable_type} /></div>}

      {selected && (
        <Card className="mt-6">
          <CoreManager
            key={`${selected.id}:${selected.cable_type}`}
            reloadKey={networkVersion}
            onChanged={networkChanged}
            source="olt_to_odc"
            parentId={selected.id}
            cableType={selected.cable_type}
            title={`Core OLT → ${selected.name}`}
          />
        </Card>
      )}

      {selected && (
        <Card className="mt-6">
          <SplitterManager key={`${selected.id}:${selected.cable_type}`} onChanged={networkChanged} parentType="odc" parentId={selected.id} title={`Splitter di ${selected.name}`} />
        </Card>
      )}

      <Modal busy={saving} open={!!modal} title={modal?.mode === "add" ? "Tambah ODC" : "Edit ODC"} onClose={() => { if (!saving) setModal(null); }}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Nama ODC">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Induk OLT">
            <select className="input" value={form.olt_id} onChange={(e) => setForm({ ...form, olt_id: e.target.value, feeder_port_ids: [] })} required>
              <option value="" disabled>Pilih OLT…</option>
              {olts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Tipe Kabel">
            <select className="input" value={form.cable_type} onChange={(e) => setForm({ ...form, cable_type: e.target.value })}>
              {CABLE_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label={`Interface feeder langsung dari OLT — boleh lebih dari satu (${form.feeder_port_ids.length} dipilih)`}>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line bg-panel2 p-2">
              {portsForOlt.length === 0 && (
                <div className="px-1 py-2 text-xs text-mut">OLT ini belum punya interface tercatat. Catat port di Manajemen OLT terlebih dahulu.</div>
              )}
              {portsForOlt.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-panel">
                  <input
                    type="checkbox"
                    checked={form.feeder_port_ids.includes(p.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        feeder_port_ids: e.target.checked
                          ? [...form.feeder_port_ids, p.id]
                          : form.feeder_port_ids.filter((x) => x !== p.id),
                      })
                    }
                  />
                  <span className="font-medium">{interfaceLabel(p)}</span>
                  <span className="text-mut">
                    {p.sfp ? `${p.sfp} · ` : ""}{p.status === "active" ? "aktif" : p.status}
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <p className="text-[11px] text-mut">Daftar di atas hanya mencatat port yang masuk ke kabinet. Setelah disimpan, klik ODC lalu isi “Interface OLT → Core Feeder” untuk menentukan asal setiap core. Jika dari ODC induk, gunakan sambungan output splitter, bukan feeder langsung.</p>
          <Field label="Lokasi / Koordinat">
            <input
              className="input"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="mis. Perempatan Kota atau -0.7893, 100.6512"
            />
          </Field>
          <CoordinateFields form={form} onChange={setForm} />
          <Field label="Catatan">
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <button className="btn btn-primary w-full" disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</button>
        </form>
      </Modal>

      <Toast toast={toastState} />
    </div>
  );
}
