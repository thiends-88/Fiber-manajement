import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Badge, Empty, Field, Modal, Toast, useToast } from "./ui.jsx";
import { STATUS, colorForCoreInCable, coresPerTube, getCableInfo, tubeForCoreInCable } from "../lib/fiber.js";

/**
 * Grid core untuk satu kabel (ODC: olt_to_odc, ODP: odc_to_odp).
 * Warna core mengikuti standar TIA/EIA-598, di-reset tiap tube.
 */
export default function CoreManager({ source, parentId, cableType, title }) {
  const { user } = useAuth();
  const canWrite = user.role === "admin" || user.role === "operator";

  const [cores, setCores] = useState([]);
  const [modal, setModal] = useState(null); // { core, assign }
  const [form, setForm] = useState({ status: "idle", destination: "", power_dbm: "", notes: "" });
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);

  const info = getCableInfo(cableType);
  const total = info?.cores ?? 12;
  const perTube = coresPerTube(cableType);

  const load = useCallback(() => {
    if (!parentId) return;
    const q = source === "olt_to_odc" ? `?source=olt_to_odc&odc_id=${parentId}` : `?source=odc_to_odp&odp_id=${parentId}`;
    api(`/api/cores${q}`).then(setCores).catch((e) => toast(e.message, "error"));
  }, [source, parentId, toast]);

  useEffect(load, [load]);

  function openCore(n) {
    const assign = cores.find((c) => c.core === n) || null;
    setForm({
      status: assign?.status ?? "idle",
      destination: assign?.destination ?? "",
      power_dbm: assign?.power_dbm ?? "",
      notes: assign?.notes ?? "",
    });
    setModal({ core: n, assign });
  }

  async function save(e) {
    e.preventDefault();
    try {
      if (modal.assign) {
        await api(`/api/cores/${modal.assign.id}`, { method: "PATCH", body: form });
      } else {
        await api("/api/cores", {
          method: "POST",
          body: {
            source,
            odc_id: source === "olt_to_odc" ? parentId : null,
            odp_id: source === "odc_to_odp" ? parentId : null,
            core: modal.core,
            ...form,
          },
        });
      }
      setModal(null);
      await load();
      toast("Core tersimpan");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function remove() {
    if (!modal.assign) return;
    if (!confirm(`Hapus data core ${modal.core}?`)) return;
    try {
      await api(`/api/cores/${modal.assign.id}`, { method: "DELETE" });
      setModal(null);
      await load();
      toast("Core dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  const byStatus = cores.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-semibold">{title}</span>
          <span className="ml-2 text-mut">
            {info ? `${info.label} · ${info.tubes} tube` : "tipe kabel tidak diketahui"}
          </span>
        </div>
        <div className="flex gap-2">
          {Object.entries(STATUS).map(([k, v]) => (
            <Badge key={k} cls={v.cls}>
              {v.label}: {byStatus[k] ?? 0}
            </Badge>
          ))}
        </div>
      </div>

      {!info ? (
        <Empty text="Pilih tipe kabel yang valid untuk menampilkan core." />
      ) : (
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
            const assign = cores.find((c) => c.core === n);
            const fc = colorForCoreInCable(n, perTube);
            const tube = tubeForCoreInCable(n, perTube);
            const border =
              assign?.status === "used"
                ? "border-emerald-500/60"
                : assign?.status === "reserved"
                  ? "border-amber-500/60"
                  : assign?.status === "damaged"
                    ? "border-red-500/60"
                    : assign
                      ? "border-line"
                      : "border-dashed border-line/70";
            return (
              <button
                key={n}
                disabled={!canWrite}
                onClick={() => openCore(n)}
                title={`Core ${n} · Tube ${tube} · ${fc.name}${assign ? ` · ${STATUS[assign.status].label}${assign.power_dbm ? ` · ${assign.power_dbm} dBm` : ""}` : " · belum dicatat"}`}
                className={`flex flex-col items-center gap-1 rounded-lg border bg-panel2 p-2 transition hover:border-acc ${border}`}
              >
                <span
                  className="block size-4 rounded-full ring-1 ring-white/20"
                  style={{ background: fc.hex }}
                />
                <span className="text-[11px] font-semibold">{n}</span>
                <span className="text-[9px] text-mut">T{tube}{assign?.power_dbm ? ` · ${assign.power_dbm}dBm` : ""}</span>
              </button>
            );
          })}
        </div>
      )}

      <Modal open={!!modal} title={modal ? `Core ${modal.core} — ${title}` : ""} onClose={() => setModal(null)}>
        {modal && (
          <form onSubmit={save} className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-mut">
              <span
                className="inline-block size-4 rounded-full ring-1 ring-white/20"
                style={{ background: colorForCoreInCable(modal.core, perTube).hex }}
              />
              Warna {colorForCoreInCable(modal.core, perTube).name} · Tube {tubeForCoreInCable(modal.core, perTube)}
            </div>
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Tujuan">
              <input className="input" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} />
            </Field>
            <Field label="Daya optik terukur (dBm) — opsional">
              <input
                className="input" type="number" step="0.1" placeholder="mis. -19.5"
                value={form.power_dbm} onChange={(e) => setForm({ ...form, power_dbm: e.target.value })}
              />
            </Field>
            <Field label="Catatan">
              <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1">Simpan</button>
              {modal.assign && (
                <button type="button" className="btn btn-danger" onClick={remove}>
                  Hapus
                </button>
              )}
            </div>
          </form>
        )}
      </Modal>

      <Toast toast={toastState} />
    </div>
  );
}
