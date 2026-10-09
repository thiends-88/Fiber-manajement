import { useCallback, useEffect, useState } from "react";
import { Network, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Card, Field, Modal, PageHeader, Toast, useToast } from "../components/ui.jsx";
import CoreManager from "../components/CoreManager.jsx";
import SplitterManager from "../components/SplitterManager.jsx";
import { CABLE_TYPES, getCableInfo } from "../lib/fiber.js";

const empty = { name: "", odc_id: "", location: "", cable_type: CABLE_TYPES[4].value, notes: "" };

export default function Odps() {
  const { user } = useAuth();
  const canWrite = user.role === "admin" || user.role === "operator";

  const [odps, setOdps] = useState([]);
  const [odcs, setOdcs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);

  const load = useCallback(async () => {
    const [p, d] = await Promise.all([api("/api/odps"), api("/api/odcs")]);
    setOdps(p);
    setOdcs(d);
  }, []);

  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, [load, toast]);

  async function save(e) {
    e.preventDefault();
    try {
      const body = { ...form, odc_id: Number(form.odc_id) };
      if (modal.mode === "add") await api("/api/odps", { method: "POST", body });
      else await api(`/api/odps/${modal.odp.id}`, { method: "PATCH", body: { ...modal.odp, ...body } });
      setModal(null);
      await load();
      toast("ODP tersimpan");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function remove(odp) {
    if (!confirm(`Hapus ODP "${odp.name}" beserta core assignment-nya?`)) return;
    try {
      await api(`/api/odps/${odp.id}`, { method: "DELETE" });
      if (selectedId === odp.id) setSelectedId(null);
      await load();
      toast("ODP dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  const selected = odps.find((d) => d.id === selectedId);

  return (
    <div>
      <PageHeader title="Manajemen ODP" desc="Optical Distribution Point — klik baris untuk mengelola core.">
        {canWrite && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setForm({ ...empty, odc_id: odcs[0]?.id ?? "" });
              setModal({ mode: "add" });
            }}
          >
            <Plus size={15} /> Tambah ODP
          </button>
        )}
      </PageHeader>

      <Card className="overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Nama</th>
              <th className="th">Induk ODC</th>
              <th className="th">Kabel</th>
              <th className="th">Lokasi</th>
              <th className="th">Core</th>
              {canWrite && <th className="th">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {odps.map((d) => (
              <tr
                key={d.id}
                className={`cursor-pointer border-b border-line-soft last:border-0 hover:bg-panel2 ${d.id === selectedId ? "bg-panel2" : ""}`}
                onClick={() => setSelectedId(d.id === selectedId ? null : d.id)}
              >
                <td className="td font-medium">
                  <span className="mr-2 inline-block text-amber-400"><Network size={14} /></span>
                  {d.name}
                </td>
                <td className="td text-mut">{d.odc_name}</td>
                <td className="td text-mut">{getCableInfo(d.cable_type)?.label ?? d.cable_type}</td>
                <td className="td text-mut">{d.location || "-"}</td>
                <td className="td">{d.core_count}</td>
                {canWrite && (
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button
                        className="btn px-2 py-1"
                        onClick={() => {
                          setForm({ name: d.name, odc_id: d.odc_id, location: d.location || "", cable_type: d.cable_type, notes: d.notes || "" });
                          setModal({ mode: "edit", odp: d });
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button className="btn px-2 py-1 text-red-400" onClick={() => remove(d)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {odps.length === 0 && (
              <tr>
                <td className="td py-8 text-center text-mut" colSpan={canWrite ? 6 : 5}>Belum ada ODP.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {selected && (
        <Card className="mt-6">
          <CoreManager
            source="odc_to_odp"
            parentId={selected.id}
            cableType={selected.cable_type}
            title={`Core Power ${selected.name}`}
          />
        </Card>
      )}

      {selected && (
        <Card className="mt-6">
          <SplitterManager parentType="odp" parentId={selected.id} title={`Splitter di ${selected.name}`} />
        </Card>
      )}

      <Modal open={!!modal} title={modal?.mode === "add" ? "Tambah ODP" : "Edit ODP"} onClose={() => setModal(null)}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Nama ODP">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Induk ODC">
            <select className="input" value={form.odc_id} onChange={(e) => setForm({ ...form, odc_id: e.target.value })} required>
              <option value="" disabled>Pilih ODC…</option>
              {odcs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Tipe Kabel">
            <select className="input" value={form.cable_type} onChange={(e) => setForm({ ...form, cable_type: e.target.value })}>
              {CABLE_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Lokasi / Koordinat">
            <input
              className="input"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="mis. Tiang depan pasar atau -0.7912, 100.6488"
            />
          </Field>
          <Field label="Catatan">
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <button className="btn btn-primary w-full">Simpan</button>
        </form>
      </Modal>

      <Toast toast={toastState} />
    </div>
  );
}
