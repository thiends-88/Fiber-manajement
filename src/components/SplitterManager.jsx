import { useCallback, useEffect, useState } from "react";
import { GitBranch, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Badge, Empty, Field, Modal, Toast, useToast } from "./ui.jsx";
import { SPLITTER_RATIOS } from "../lib/fiber.js";

const emptySplitter = { name: "", ratio: "1:8", input_core: "", input_note: "", notes: "" };

const RATIO_CLS = {
  "1:2": "bg-cyan-500/15 text-cyan-300",
  "1:4": "bg-emerald-500/15 text-emerald-300",
  "1:8": "bg-amber-500/15 text-amber-300",
  "1:16": "bg-fuchsia-500/15 text-fuchsia-300",
  "1:32": "bg-rose-500/15 text-rose-300",
};

/**
 * Manajemen splitter untuk satu ODC atau ODP.
 * Output splitter bisa diarahkan ke ODP lain ATAU ke splitter lain (cascade),
 * contoh topologi bertingkat 4:8:8.
 */
export default function SplitterManager({ parentType, parentId, title }) {
  const { user } = useAuth();
  const canWrite = user.role === "admin" || user.role === "operator";

  const [splitters, setSplitters] = useState([]);
  const [odps, setOdps] = useState([]);
  const [allSplitters, setAllSplitters] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptySplitter);
  const [outModal, setOutModal] = useState(null);
  const [outForm, setOutForm] = useState({ target_type: "", target_id: "", notes: "" });
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);

  const q = parentType === "odc" ? `odc_id=${parentId}` : `odp_id=${parentId}`;

  const load = useCallback(async () => {
    const [mine, o, all] = await Promise.all([
      api(`/api/splitters?${q}`),
      api("/api/odps"),
      api("/api/splitters"),
    ]);
    setSplitters(mine);
    setOdps(o);
    setAllSplitters(all);
  }, [q]);

  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, [load, toast]);

  function openAdd() {
    setForm({ ...emptySplitter, name: `SPL-${splitters.length + 1}` });
    setModal({ mode: "add" });
  }

  async function save(e) {
    e.preventDefault();
    try {
      const body = {
        ...form,
        input_core: form.input_core === "" ? null : Number(form.input_core),
        odc_id: parentType === "odc" ? Number(parentId) : null,
        odp_id: parentType === "odp" ? Number(parentId) : null,
      };
      if (modal.mode === "add") await api("/api/splitters", { method: "POST", body });
      else await api(`/api/splitters/${modal.splitter.id}`, { method: "PATCH", body });
      setModal(null);
      await load();
      toast("Splitter tersimpan");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function remove(sp) {
    if (!confirm(`Hapus splitter "${sp.name}" beserta arah output-nya?`)) return;
    try {
      await api(`/api/splitters/${sp.id}`, { method: "DELETE" });
      await load();
      toast("Splitter dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function openOutput(sp, out) {
    setOutForm({
      target_type: out.target_type || "",
      target_id:
        out.target_type === "odp" ? out.target_odp_id : out.target_type === "splitter" ? out.target_splitter_id : "",
      notes: out.notes || "",
    });
    setOutModal({ splitter: sp, out });
  }

  async function saveOutput(e) {
    e.preventDefault();
    try {
      await api(`/api/splitter-outputs/${outModal.out.id}`, {
        method: "PATCH",
        body: {
          target_type: outForm.target_type || null,
          target_id: outForm.target_id === "" ? null : Number(outForm.target_id),
          notes: outForm.notes,
        },
      });
      setOutModal(null);
      await load();
      toast("Arah output disimpan");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  const targetLabel = (o) =>
    o.target_type === "odp"
      ? o.target_odp_name
      : o.target_type === "splitter"
        ? `⇄ ${o.target_splitter_name}`
        : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <GitBranch size={16} className="text-violet-400" />
          {title || `Splitter di ${parentType === "odc" ? "ODC" : "ODP"} ini`}
          <span className="text-xs font-normal text-mut">— output bisa ke ODP atau di-cascade ke splitter lain</span>
        </h2>
        {canWrite && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={14} /> Tambah Splitter
          </button>
        )}
      </div>

      {splitters.length === 0 && (
        <Empty text="Belum ada splitter. Contoh topologi 4:8:8 → SPL-1 (1:4) → SPL-2 (1:8) → ODP (SPL 1:8)." />
      )}

      <div className="space-y-3">
        {splitters.map((sp) => {
          const assigned = sp.outputs.filter((o) => o.target_type).length;
          return (
            <div key={sp.id} className="rounded-xl border border-line bg-panel2/50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">{sp.name}</span>
                <Badge cls={RATIO_CLS[sp.ratio] || "bg-slate-500/15 text-slate-300"}>Splitter {sp.ratio}</Badge>
                <Badge cls="bg-slate-500/15 text-slate-300">
                  {sp.input_core ? `Input core ${sp.input_core}` : "Input belum diisi"}
                  {sp.input_note ? ` · ${sp.input_note}` : ""}
                </Badge>
                <span className="text-mut">{assigned}/{sp.outputs.length} output terarah</span>
                {canWrite && (
                  <span className="ml-auto flex gap-1">
                    <button
                      className="btn px-2 py-1"
                      title="Edit splitter"
                      onClick={() => {
                        setForm({
                          name: sp.name,
                          ratio: sp.ratio,
                          input_core: sp.input_core ?? "",
                          input_note: sp.input_note || "",
                          notes: sp.notes || "",
                        });
                        setModal({ mode: "edit", splitter: sp });
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button className="btn px-2 py-1 text-red-400" title="Hapus splitter" onClick={() => remove(sp)}>
                      <Trash2 size={13} />
                    </button>
                  </span>
                )}
              </div>

              {sp.notes && <div className="mt-1 text-[11px] text-mut">Catatan: {sp.notes}</div>}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {sp.outputs.map((o) => {
                  const label = targetLabel(o);
                  const cls = o.target_type === "odp"
                    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                    : o.target_type === "splitter"
                      ? "border-violet-500/60 bg-violet-500/10 text-violet-300"
                      : "border-dashed border-line text-mut";
                  return (
                    <button
                      key={o.id}
                      disabled={!canWrite}
                      onClick={() => openOutput(sp, o)}
                      title={`Output ${o.port}${label ? ` → ${label.replace("⇄ ", "")}` : " (belum diarahkan)"}${o.notes ? ` · ${o.notes}` : ""}`}
                      className={`rounded-lg border px-2 py-1 text-[11px] transition hover:brightness-125 ${cls}`}
                    >
                      <span className="font-semibold">out {o.port}</span>
                      {label ? <span className="ml-1">{label}</span> : <span className="ml-1">kosong</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal splitter */}
      <Modal open={!!modal} title={modal?.mode === "add" ? "Tambah Splitter" : "Edit Splitter"} onClose={() => setModal(null)}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Nama / Label Splitter">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rasio Splitter">
              <select className="input" value={form.ratio} onChange={(e) => setForm({ ...form, ratio: e.target.value })}>
                {SPLITTER_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Input dari Core (opsional)">
              <input
                className="input" type="number" min={1} placeholder="mis. 1"
                value={form.input_core} onChange={(e) => setForm({ ...form, input_core: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Keterangan Input (opsional)">
            <input
              className="input" placeholder="mis. Core 1 feeder dari OLT"
              value={form.input_note} onChange={(e) => setForm({ ...form, input_note: e.target.value })}
            />
          </Field>
          <Field label="Catatan">
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <button className="btn btn-primary w-full">Simpan</button>
        </form>
      </Modal>

      {/* Modal arah output */}
      <Modal
        open={!!outModal}
        title={outModal ? `${outModal.splitter.name} — output ${outModal.out.port}` : ""}
        onClose={() => setOutModal(null)}
      >
        {outModal && (
          <form onSubmit={saveOutput} className="space-y-3">
            <Field label="Arahkan output ini ke">
              <select
                className="input"
                value={outForm.target_type}
                onChange={(e) => setOutForm({ ...outForm, target_type: e.target.value, target_id: "" })}
              >
                <option value="">Kosong (belum dipakai)</option>
                <option value="odp">ODP</option>
                <option value="splitter">Splitter lain (cascade)</option>
              </select>
            </Field>
            {outForm.target_type === "odp" && (
              <Field label="Pilih ODP">
                <select
                  className="input" required
                  value={outForm.target_id}
                  onChange={(e) => setOutForm({ ...outForm, target_id: e.target.value })}
                >
                  <option value="" disabled>Pilih ODP…</option>
                  {odps.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {p.odc_name}</option>
                  ))}
                </select>
              </Field>
            )}
            {outForm.target_type === "splitter" && (
              <Field label="Pilih splitter lanjutan">
                <select
                  className="input" required
                  value={outForm.target_id}
                  onChange={(e) => setOutForm({ ...outForm, target_id: e.target.value })}
                >
                  <option value="" disabled>Pilih splitter…</option>
                  {allSplitters
                    .filter((x) => x.id !== outModal.splitter.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.ratio}) — {x.odc_name || x.odp_name || "-"}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label="Catatan">
              <input className="input" value={outForm.notes} onChange={(e) => setOutForm({ ...outForm, notes: e.target.value })} />
            </Field>
            <button className="btn btn-primary w-full">Simpan Arah Output</button>
          </form>
        )}
      </Modal>

      <Toast toast={toastState} />
    </div>
  );
}
