import { useCallback, useEffect, useState } from "react";
import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Card, Empty, Field, Modal, PageHeader, Toast, useToast } from "../components/ui.jsx";
import CoreManager from "../components/CoreManager.jsx";
import { CABLE_TYPES, getCableInfo } from "../lib/fiber.js";

const empty = { name: "", olt_id: "", location: "", cable_type: CABLE_TYPES[0].value, notes: "" };

export default function Odcs() {
  const { user } = useAuth();
  const canWrite = user.role === "admin" || user.role === "operator";

  const [odcs, setOdcs] = useState([]);
  const [olts, setOlts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);

  const load = useCallback(async () => {
    const [d, o] = await Promise.all([api("/api/odcs"), api("/api/olts")]);
    setOdcs(d);
    setOlts(o);
  }, []);

  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, [load, toast]);

  async function save(e) {
    e.preventDefault();
    try {
      const body = { ...form, olt_id: Number(form.olt_id) };
      if (modal.mode === "add") await api("/api/odcs", { method: "POST", body });
      else await api(`/api/odcs/${modal.odc.id}`, { method: "PATCH", body: { ...modal.odc, ...body } });
      setModal(null);
      await load();
      toast("ODC tersimpan");
    } catch (err) {
      toast(err.message, "error");
    }
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

      <Card className="overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Nama</th>
              <th className="th">Induk OLT</th>
              <th className="th">Kabel</th>
              <th className="th">Lokasi</th>
              <th className="th">Core</th>
              <th className="th">ODP</th>
              {canWrite && <th className="th">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {odcs.map((d) => (
              <tr
                key={d.id}
                className={`cursor-pointer border-b border-line/50 last:border-0 hover:bg-panel2 ${d.id === selectedId ? "bg-panel2" : ""}`}
                onClick={() => setSelectedId(d.id === selectedId ? null : d.id)}
              >
                <td className="td font-medium">
                  <span className="mr-2 inline-block text-emerald-400"><Boxes size={14} /></span>
                  {d.name}
                </td>
                <td className="td text-mut">{d.olt_name}</td>
                <td className="td text-mut">{getCableInfo(d.cable_type)?.label ?? d.cable_type}</td>
                <td className="td text-mut">{d.location || "-"}</td>
                <td className="td">{d.core_count}</td>
                <td className="td">{d.odp_count}</td>
                {canWrite && (
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button
                        className="btn px-2 py-1"
                        onClick={() => {
                          setForm({ name: d.name, olt_id: d.olt_id, location: d.location || "", cable_type: d.cable_type, notes: d.notes || "" });
                          setModal({ mode: "edit", odc: d });
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
            {odcs.length === 0 && (
              <tr>
                <td className="td py-8 text-center text-mut" colSpan={7}>Belum ada ODC.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {selected && (
        <Card className="mt-6">
          <CoreManager
            source="olt_to_odc"
            parentId={selected.id}
            cableType={selected.cable_type}
            title={`Core OLT → ${selected.name}`}
          />
        </Card>
      )}

      <Modal open={!!modal} title={modal?.mode === "add" ? "Tambah ODC" : "Edit ODC"} onClose={() => setModal(null)}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Nama ODC">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Induk OLT">
            <select className="input" value={form.olt_id} onChange={(e) => setForm({ ...form, olt_id: e.target.value })} required>
              <option value="" disabled>Pilih OLT…</option>
              {olts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Tipe Kabel">
            <select className="input" value={form.cable_type} onChange={(e) => setForm({ ...form, cable_type: e.target.value })}>
              {CABLE_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Lokasi">
            <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
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
