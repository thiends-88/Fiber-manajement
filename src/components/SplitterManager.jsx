import { useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Badge, Empty, Field, Modal, Toast, useToast } from "./ui.jsx";
import { SPLITTER_RATIOS, getCableInfo } from "../lib/fiber.js";

const emptySplitter = { name: "", ratio: "1:8", input_core: "", input_note: "", notes: "" };

const RATIO_CLS = {
  "1:2": "bg-cyan-500/15 text-cyan-300",
  "1:4": "bg-emerald-500/15 text-emerald-300",
  "1:8": "bg-amber-500/15 text-amber-300",
  "1:16": "bg-fuchsia-500/15 text-fuchsia-300",
  "1:32": "bg-rose-500/15 text-rose-300",
};

const sameEnclosure = (a, b) => {
  if (a?.odc_id != null) return b?.odc_id != null && Number(a.odc_id) === Number(b.odc_id);
  if (a?.odp_id != null) return b?.odp_id != null && Number(a.odp_id) === Number(b.odp_id);
  return false;
};

/**
 * Manajemen splitter untuk satu ODC atau ODP.
 * Output splitter bisa diarahkan ke ODP lain ATAU ke splitter lain (cascade),
 * untuk topologi splitter bertingkat.
 */
export default function SplitterManager({ parentType, parentId, title }) {
  const { user } = useAuth();
  const canWrite = user.role === "admin" || user.role === "operator";
  // ODP selalu memakai splitter 1:8 bawaan (dibuat otomatis & permanen) —
  // jadi tidak ada tombol tambah/hapus dan rasio terkunci di 1:8.
  const isOdp = parentType === "odp";

  const [splitters, setSplitters] = useState([]);
  const [odps, setOdps] = useState([]);
  const [odcs, setOdcs] = useState([]);
  const [allSplitters, setAllSplitters] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptySplitter);
  const [outModal, setOutModal] = useState(null);
  const [outForm, setOutForm] = useState({ target_type: "", target_id: "", notes: "" });
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);

  const q = parentType === "odc" ? `odc_id=${parentId}` : `odp_id=${parentId}`;
  const parent = parentType === "odc"
    ? odcs.find((d) => d.id === Number(parentId))
    : odps.find((d) => d.id === Number(parentId));
  const inputCoreMax = getCableInfo(parent?.cable_type)?.cores;
  const { childrenById, cascadeParentById, treeRoots } = useMemo(() => {
    const byId = new Map(splitters.map((sp) => [Number(sp.id), sp]));
    const children = new Map(splitters.map((sp) => [Number(sp.id), []]));
    const parents = new Map();

    for (const sp of splitters) {
      for (const output of sp.outputs || []) {
        if (output.target_type !== "splitter" || !output.target_splitter_id) continue;
        const child = byId.get(Number(output.target_splitter_id));
        if (!child) continue;
        children.get(Number(sp.id))?.push({ splitter: child, port: output.port });
        if (!parents.has(Number(child.id))) parents.set(Number(child.id), { splitter: sp, port: output.port });
      }
    }
    for (const list of children.values()) list.sort((a, b) => Number(a.port) - Number(b.port));

    const roots = splitters
      .filter((sp) => !parents.has(Number(sp.id)))
      .sort((a, b) => {
        const coreA = a.input_core == null ? Number.POSITIVE_INFINITY : Number(a.input_core);
        const coreB = b.input_core == null ? Number.POSITIVE_INFINITY : Number(b.input_core);
        return coreA - coreB || String(a.name).localeCompare(String(b.name), "id");
      });
    return { childrenById: children, cascadeParentById: parents, treeRoots: roots };
  }, [splitters]);

  const load = useCallback(async () => {
    const [mine, o, all, ds] = await Promise.all([
      api(`/api/splitters?${q}`),
      api("/api/odps"),
      api("/api/splitters"),
      api("/api/odcs"),
    ]);
    setSplitters(mine);
    setOdps(o);
    setAllSplitters(all);
    setOdcs(ds);
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
      : o.target_type === "odc"
        ? `⇉ ${o.target_odc_name}`
        : o.target_type === "splitter"
          ? `⇄ ${o.target_splitter_name}`
          : null;

  const renderSplitterTree = (sp, level = 1, via = null, path = new Set()) => {
    const id = Number(sp.id);
    if (path.has(id)) {
      return (
        <div key={`cascade-loop-${id}`} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-300">
          Rantai cascade berputar kembali ke {sp.name}; periksa sambungan output.
        </div>
      );
    }
    const nextPath = new Set(path);
    nextPath.add(id);
    const children = childrenById.get(id) || [];
    const assigned = (sp.outputs || []).filter((o) => o.target_type).length;
    const inputLabel = via
      ? `Masuk dari ${via.parent.name} · out ${via.port}`
      : sp.input_core
        ? `Input core ${sp.input_core}${sp.input_note ? ` · ${sp.input_note}` : ""}`
        : "Input belum diisi";

    return (
      <div key={`splitter-tree-${sp.id}`}>
        <div className="rounded-xl border border-line bg-panel-soft p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge cls="bg-violet-500/15 text-violet-300">Tahap {level}</Badge>
            <span className="font-semibold">{sp.name}</span>
            <Badge cls={RATIO_CLS[sp.ratio] || "bg-slate-500/15 text-slate-300"}>Splitter {sp.ratio}</Badge>
            <Badge cls={via ? "bg-violet-500/15 text-violet-300" : "bg-slate-500/15 text-slate-300"}>{inputLabel}</Badge>
            <span className="text-mut">{assigned}/{sp.outputs.length} output terarah</span>
            {canWrite && (
              <span className="ml-auto flex gap-1">
                <button
                  className="btn px-2 py-1"
                  title="Edit splitter"
                  onClick={() => {
                    const cascadeParent = cascadeParentById.get(Number(sp.id));
                    setForm({
                      name: sp.name,
                      ratio: sp.ratio,
                      input_core: cascadeParent ? "" : sp.input_core ?? "",
                      input_note: cascadeParent ? "" : sp.input_note || "",
                      notes: sp.notes || "",
                    });
                    setModal({ mode: "edit", splitter: sp });
                  }}
                >
                  <Pencil size={13} />
                </button>
                {!isOdp && (
                  <button className="btn px-2 py-1 text-red-400" title="Hapus splitter" onClick={() => remove(sp)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </span>
            )}
          </div>

          {sp.notes && <div className="mt-1 text-[11px] text-mut">Catatan: {sp.notes}</div>}

          <div className="mt-2 flex flex-wrap gap-1.5">
            {(sp.outputs || []).map((o) => {
              const label = targetLabel(o);
              const cls = o.target_type === "odp"
                ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                : o.target_type === "odc"
                  ? "border-sky-500/60 bg-sky-500/10 text-sky-300"
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

        {children.length > 0 && (
          <div className="ml-4 mt-2 space-y-2 border-l-2 border-violet-500/40 pl-3">
            {children.map(({ splitter: child, port }) =>
              renderSplitterTree(child, level + 1, { parent: sp, port }, nextPath),
            )}
          </div>
        )}
      </div>
    );
  };
  const editingCascadeParent = modal?.mode === "edit"
    ? cascadeParentById.get(Number(modal.splitter.id)) || null
    : null;
  const cascadeTargets = outModal
    ? allSplitters.filter((sp) => Number(sp.id) !== Number(outModal.splitter.id) && sameEnclosure(outModal.splitter, sp))
    : [];
  const selectedCascadeTarget = outForm.target_type === "splitter"
    ? allSplitters.find((sp) => Number(sp.id) === Number(outForm.target_id))
    : null;
  const legacyCascadeTarget = selectedCascadeTarget && !cascadeTargets.some((sp) => Number(sp.id) === Number(selectedCascadeTarget.id))
    ? selectedCascadeTarget
    : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <GitBranch size={16} className="text-violet-400" />
          {title || `Splitter di ${parentType === "odc" ? "ODC" : "ODP"} ini`}
          <span className="text-xs font-normal text-mut">
            {isOdp
              ? "— splitter 1:8 bawaan ODP (otomatis & permanen)"
              : "— susun tahap splitter lewat cascade dalam ODC yang sama, lalu arahkan ke ODP atau ODC anak"}
          </span>
        </h2>
        {canWrite && !isOdp && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={14} /> Tambah Splitter
          </button>
        )}
      </div>

      {splitters.length === 0 && (
        <Empty
          text={
            isOdp
              ? "Splitter 1:8 bawaan ODP sedang disiapkan — muat ulang halaman bila belum tampil."
              : "Belum ada splitter. Tambahkan tahap awal, lalu arahkan salah satu output ke splitter lanjutan (mis. 1:4 → 1:4) atau ke ODP."
          }
        />
      )}

      {splitters.length > 0 && !isOdp && (
        <div className="mb-2 flex items-center gap-2 text-[11px] text-mut">
          <GitBranch size={13} className="text-violet-400" />
          Tahap lanjutan ditampilkan bertingkat di bawah splitter induk. Klik chip <span className="font-semibold text-violet-300">out N</span> untuk menyambungkan splitter berikutnya.
        </div>
      )}

      <div className="space-y-3">
        {(treeRoots.length > 0 ? treeRoots : splitters).map((sp) => renderSplitterTree(sp))}
      </div>

      {/* Modal splitter */}
      <Modal open={!!modal} title={modal?.mode === "add" ? "Tambah Splitter" : "Edit Splitter"} onClose={() => setModal(null)}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Nama / Label Splitter">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rasio Splitter">
              {isOdp ? (
                <input className="input" value="1:8 (standar ODP)" disabled readOnly />
              ) : (
                <select className="input" value={form.ratio} onChange={(e) => setForm({ ...form, ratio: e.target.value })}>
                  {SPLITTER_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
            </Field>
            <Field label={editingCascadeParent ? "Input dari splitter induk" : "Input dari Core (opsional, tahap awal)"}>
              {editingCascadeParent ? (
                <input
                  className="input"
                  value={`${editingCascadeParent.splitter.name} · output ${editingCascadeParent.port}`}
                  disabled
                  readOnly
                />
              ) : (
                <input
                  className="input" type="number" min={1} max={inputCoreMax} placeholder="mis. 1"
                  value={form.input_core} onChange={(e) => setForm({ ...form, input_core: e.target.value })}
                />
              )}
            </Field>
          </div>
          {editingCascadeParent ? (
            <p className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-[11px] leading-relaxed text-mut">
              Input tahap ini mengikuti sambungan cascade dari splitter induk; tidak perlu mengisi core OLT lagi.
            </p>
          ) : (
            <Field label="Keterangan Input (opsional)">
              <input
                className="input" placeholder="mis. Core 1 feeder dari OLT"
                value={form.input_note} onChange={(e) => setForm({ ...form, input_note: e.target.value })}
              />
            </Field>
          )}
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
                <option value="odc">ODC anak (ODC lain)</option>
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
            {outForm.target_type === "odc" && (
              <Field label="Pilih ODC anak">
                <select
                  className="input" required
                  value={outForm.target_id}
                  onChange={(e) => setOutForm({ ...outForm, target_id: e.target.value })}
                >
                  <option value="" disabled>Pilih ODC…</option>
                  {odcs
                    .filter((d) => !outModal.splitter.odc_id || d.id !== outModal.splitter.odc_id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>{d.name} — {d.olt_name}</option>
                    ))}
                </select>
              </Field>
            )}
            {outForm.target_type === "splitter" && (
              <>
                <p className="rounded-lg border border-line-soft bg-panel2 px-3 py-2 text-[11px] leading-relaxed text-mut">
                  <span className="font-medium text-ink">Cascade</span> menyambungkan output ini ke input tahap berikutnya di {outModal.splitter.odc_id != null ? "ODC" : "ODP"} yang sama.
                  Contoh: <span className="font-medium text-ink">1:4 awal · out 1 → 1:4 kedua</span>. Input core splitter lanjutan mengikuti sambungan ini secara otomatis.
                </p>
                <Field label="Pilih splitter lanjutan">
                  <select
                    className="input" required
                    value={outForm.target_id}
                    onChange={(e) => setOutForm({ ...outForm, target_id: e.target.value })}
                  >
                    <option value="" disabled>
                      {cascadeTargets.length ? "Pilih splitter…" : `Tidak ada splitter lain di ${outModal.splitter.odc_id != null ? "ODC" : "ODP"} ini`}
                    </option>
                    {legacyCascadeTarget && (
                      <option value={legacyCascadeTarget.id} disabled>
                        {legacyCascadeTarget.name} ({legacyCascadeTarget.ratio}) — cascade lintas lokasi, pilih target lain
                      </option>
                    )}
                    {cascadeTargets.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name} ({sp.ratio})
                      </option>
                    ))}
                  </select>
                </Field>
              </>
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
