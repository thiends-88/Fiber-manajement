import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Link2, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Badge, Card, Empty, Field, Modal, PageHeader, Toast, useToast } from "../components/ui.jsx";
import { STATUS, colorForCoreInCable, coresPerTube, getCableInfo } from "../lib/fiber.js";

function CoreChip({ core, cableType, small }) {
  const color = colorForCoreInCable(core, coresPerTube(cableType));
  const tube = Math.floor((core - 1) / coresPerTube(cableType)) + 1;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 ${small ? "py-0.5 text-[11px]" : "py-1 text-xs"}`}>
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/30" style={{ background: color.hex }} title={color.name} />
      <span className="font-medium">Core {core}</span>
      <span className="text-mut">· {color.name} · Tube {tube}</span>
    </span>
  );
}

function Arrow() {
  return <ArrowRight size={15} className="shrink-0 text-cyan-400" />;
}

const emptyLink = { odc_id: "", odc_core: "", odp_id: "", odp_core: "", loss_db: "", notes: "" };

export default function Mapping() {
  const { user } = useAuth();
  const canWrite = user.role === "admin" || user.role === "operator";

  const [odcs, setOdcs] = useState([]);
  const [odps, setOdps] = useState([]);
  const [olts, setOlts] = useState([]);
  const [allCores, setAllCores] = useState([]);
  const [ports, setPorts] = useState([]);
  const [odcId, setOdcId] = useState("");
  const [links, setLinks] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyLink);
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);

  const load = useCallback(async () => {
    const [d, p, o, c, pt] = await Promise.all([
      api("/api/odcs"), api("/api/odps"), api("/api/olts"), api("/api/cores"), api("/api/ports"),
    ]);
    setPorts(pt);
    setOdcs(d);
    setOdps(p);
    setOlts(o);
    setAllCores(c);
    setOdcId((cur) => cur || d[0]?.id || "");
  }, []);

  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, [load, toast]);

  const loadLinks = useCallback(async (id) => {
    if (!id) return setLinks([]);
    setLinks(await api(`/api/links?odc_id=${id}`));
  }, []);

  useEffect(() => {
    loadLinks(odcId).catch((e) => toast(e.message, "error"));
  }, [odcId, loadLinks, toast]);

  const odc = odcs.find((d) => d.id === Number(odcId));
  const odcOlts = olts.find((o) => o.id === odc?.olt_id);
  const odcsOdps = useMemo(() => odps.filter((p) => p.odc_id === Number(odcId)), [odps, odcId]);

  // Core feeder OLT → ODC untuk ODC terpilih
  const feederCores = useMemo(
    () => allCores.filter((c) => c.source === "olt_to_odc" && c.odc_id === Number(odcId)).sort((a, b) => a.core - b.core),
    [allCores, odcId],
  );
  const feederByCore = useMemo(() => Object.fromEntries(feederCores.map((c) => [c.core, c])), [feederCores]);
  const linkedOdcCores = useMemo(() => new Set(links.map((l) => l.odc_core)), [links]);
  const feederPort = useMemo(() => ports.find((p) => p.id === odc?.feeder_port_id), [ports, odc]);

  // Core ODC → ODP untuk tiap ODP (dipakai untuk fallback tampilan)
  const odpCores = useMemo(
    () => allCores.filter((c) => c.source === "odc_to_odp" && odcsOdps.some((p) => p.id === c.odp_id)),
    [allCores, odcsOdps],
  );

  const cable = odc?.cable_type;
  const powerCount = feederCores.filter((c) => c.power_dbm).length;

  function openAdd() {
    setForm({ ...emptyLink, odc_id: odcId || odcs[0]?.id || "" });
    setModal({ mode: "add" });
  }

  async function save(e) {
    e.preventDefault();
    try {
      const body = {
        odc_id: Number(form.odc_id),
        odc_core: Number(form.odc_core),
        odp_id: Number(form.odp_id),
        odp_core: Number(form.odp_core),
        loss_db: form.loss_db === "" ? null : Number(form.loss_db),
        notes: form.notes,
      };
      if (modal.mode === "add") await api("/api/links", { method: "POST", body });
      else await api(`/api/links/${modal.link.id}`, { method: "PATCH", body });
      setModal(null);
      await loadLinks(odcId);
      toast("Sambungan core tersimpan");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function remove(link) {
    if (!confirm(`Hapus sambungan ODC core ${link.odc_core} → ${link.odp_name} core ${link.odp_core}?`)) return;
    try {
      await api(`/api/links/${link.id}`, { method: "DELETE" });
      await loadLinks(odcId);
      toast("Sambungan dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  const formOdc = odcs.find((d) => d.id === Number(form.odc_id));
  const formOdps = odps.filter((p) => p.odc_id === Number(form.odc_id));
  const usedFormCores = links.filter((l) => l.odc_id === Number(form.odc_id)).map((l) => l.odc_core);

  return (
    <div>
      <PageHeader
        title="Mapping Core OLT → ODC → ODP"
        desc="Peta jalur core end-to-end: port feeder OLT, core ODC, core ODP, redaman, dan daya optik (dBm)."
      >
        {canWrite && (
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={15} /> Tambah Sambungan
          </button>
        )}
      </PageHeader>

      {/* Pemilih ODC */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Pilih ODC" className="min-w-56">
            <select className="input" value={odcId} onChange={(e) => setOdcId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Pilih ODC…</option>
              {odcs.map((d) => (
                <option key={d.id} value={d.id}>{d.name} — {d.olt_name}</option>
              ))}
            </select>
          </Field>
          {odc && (
            <div className="flex flex-wrap gap-2 pb-1 text-xs">
              <Badge cls="bg-cyan-500/15 text-cyan-300">OLT: {odc.olt_name}{odcOlts?.olt_type ? ` (${odcOlts.olt_type})` : ""}</Badge>
              <Badge cls="bg-slate-500/15 text-slate-300">
                Feeder: {odc.feeder_card_label ? `${odc.feeder_card_label} ` : ""}{odc.feeder_port ? `port ${odc.feeder_port}` : "belum diatur"}
                {feederPort?.tx_power || feederPort?.rx_power
                  ? ` · ${feederPort.tx_power || "-"}/${feederPort.rx_power || "-"} dBm`
                  : ""}
              </Badge>
              <Badge cls="bg-violet-500/15 text-violet-300">Power: {odc.power_source || "belum diatur"}</Badge>
              <Badge cls="bg-emerald-500/15 text-emerald-400">Core ODC: {feederCores.length} terdata · {links.length} tersambung</Badge>
              <Badge cls="bg-amber-500/15 text-amber-300">Daya optik: {powerCount}/{feederCores.length} core</Badge>
            </div>
          )}
        </div>
      </Card>

      {!odc && <Card><Empty text="Pilih ODC untuk melihat peta jalur core." /></Card>}

      {odc && (
        <div className="space-y-5">
          {/* Jalur per sambungan */}
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Workflow size={16} className="text-cyan-400" />
              <h2 className="font-semibold">Peta Jalur Core</h2>
              <span className="text-xs text-mut">— alur dari OLT sampai ODP</span>
            </div>

            {links.length === 0 && <Empty text="Belum ada sambungan core ODC → ODP. Klik “Tambah Sambungan” untuk memetakan." />}

            <div className="space-y-3">
              {links.map((l) => {
                const feeder = feederByCore[l.odc_core];
                const odp = odps.find((p) => p.id === l.odp_id);
                const status = feeder ? STATUS[feeder.status] : null;
                return (
                  <div key={l.id} className="rounded-xl border border-line bg-panel2/50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* 1. OLT / port feeder */}
                      <div className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs">
                        <div className="font-semibold">{odc.olt_name}</div>
                        <div className="text-mut">
                          {odc.feeder_card_label ? `${odc.feeder_card_label} ` : ""}{odc.feeder_port ? `port ${odc.feeder_port}` : "port feeder belum diatur"}
                        </div>
                      </div>
                      <Arrow />
                      {/* 2. Core ODC */}
                      <div className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs">
                        <div className="mb-1 flex items-center gap-2">
                          <CoreChip core={l.odc_core} cableType={cable} small />
                          {status && <Badge cls={status.cls}>{status.label}</Badge>}
                        </div>
                        <div className="text-mut">
                          {odc.name} · daya: {feeder?.power_dbm ? `${feeder.power_dbm} dBm` : "belum terdata"}
                        </div>
                      </div>
                      <Arrow />
                      {/* 3. Core ODP */}
                      <div className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs">
                        <div className="mb-1 flex items-center gap-2">
                          <CoreChip core={l.odp_core} cableType={odp?.cable_type} small />
                          <Badge cls="bg-slate-500/15 text-slate-300">Redaman {l.loss_db != null ? `${l.loss_db} dB` : "-"}</Badge>
                        </div>
                        <div className="text-mut">{l.odp_name} · {odp?.location || "lokasi belum diisi"}</div>
                      </div>
                      <Arrow />
                      {/* 4. Titik pelanggan / tujuan */}
                      <div className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs">
                        <div className="font-semibold">{feeder?.customer || "Belum ada pelanggan"}</div>
                        <div className="text-mut">{feeder?.destination || "Tujuan belum diisi"}</div>
                      </div>
                      <div className="ml-auto flex items-center gap-1">
                        <Badge cls="bg-violet-500/15 text-violet-300">Power ODP: {odp?.power_source || "-"}</Badge>
                        {canWrite && (
                          <>
                            <button
                              className="btn px-2 py-1"
                              title="Edit sambungan"
                              onClick={() => {
                                setForm({
                                  odc_id: l.odc_id, odc_core: l.odc_core, odp_id: l.odp_id, odp_core: l.odp_core,
                                  loss_db: l.loss_db ?? "", notes: l.notes || "",
                                });
                                setModal({ mode: "edit", link: l });
                              }}
                            >
                              <Pencil size={13} />
                            </button>
                            <button className="btn px-2 py-1 text-red-400" title="Hapus sambungan" onClick={() => remove(l)}>
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {l.notes && <div className="mt-2 text-[11px] text-mut">Catatan: {l.notes}</div>}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Ringkasan core per ODC + ODP */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <div className="mb-3 flex items-center gap-2">
                <Link2 size={16} className="text-emerald-400" />
                <h2 className="font-semibold">Core Feeder OLT → {odc.name}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-line">
                    <tr>
                      <th className="th">Core</th>
                      <th className="th">Status</th>
                      <th className="th">Daya</th>
                      <th className="th">Pelanggan / Tujuan</th>
                      <th className="th">Sambungan ODP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feederCores.map((c) => {
                      const st = STATUS[c.status];
                      return (
                        <tr key={c.id} className="border-b border-line/50 last:border-0">
                          <td className="td"><CoreChip core={c.core} cableType={cable} small /></td>
                          <td className="td"><Badge cls={st.cls}>{st.label}</Badge></td>
                          <td className="td text-mut">{c.power_dbm ? `${c.power_dbm} dBm` : "-"}</td>
                          <td className="td text-mut">{c.customer || c.destination || "-"}</td>
                          <td className="td text-mut">
                            {linkedOdcCores.has(c.core)
                              ? (() => {
                                  const l = links.find((x) => x.odc_core === c.core);
                                  return `→ ${l.odp_name} core ${l.odp_core}`;
                                })()
                              : "belum tersambung"}
                          </td>
                        </tr>
                      );
                    })}
                    {feederCores.length === 0 && (
                      <tr><td className="td py-6 text-center text-mut" colSpan={5}>Belum ada core OLT → ODC terdata.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <div className="mb-3 flex items-center gap-2">
                <Workflow size={16} className="text-amber-400" />
                <h2 className="font-semibold">ODP di Bawah {odc.name}</h2>
              </div>
              <div className="space-y-3">
                {odcsOdps.map((p) => {
                  const cores = odpCores.filter((c) => c.odp_id === p.id);
                  const myLinks = links.filter((l) => l.odp_id === p.id);
                  return (
                    <div key={p.id} className="rounded-lg border border-line bg-panel2/50 p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-mut">{p.location || "-"}</span>
                        <Badge cls="bg-amber-500/15 text-amber-300">{getCableInfo(p.cable_type)?.label ?? p.cable_type}</Badge>
                        <Badge cls="bg-violet-500/15 text-violet-300">Power: {p.power_source || "-"}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-mut">Core terpakai dari ODC:</span>
                        {myLinks.length === 0 && <span className="text-mut">belum ada</span>}
                        {myLinks.map((l) => (
                          <span key={l.id} className="flex items-center gap-1">
                            <CoreChip core={l.odc_core} cableType={cable} small />
                            <Arrow />
                            <CoreChip core={l.odp_core} cableType={p.cable_type} small />
                          </span>
                        ))}
                      </div>
                      {cores.length > 0 && (
                        <div className="mt-2 text-mut">
                          Assignment core ODP: {cores.map((c) => `${c.core} (${STATUS[c.status].label})`).join(", ")}
                        </div>
                      )}
                    </div>
                  );
                })}
                {odcsOdps.length === 0 && <Empty text="Belum ada ODP di bawah ODC ini." />}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Modal sambungan core */}
      <Modal
        open={!!modal}
        title={modal?.mode === "add" ? "Tambah Sambungan Core" : "Edit Sambungan Core"}
        onClose={() => setModal(null)}
        wide
      >
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ODC">
              <select
                className="input"
                value={form.odc_id}
                onChange={(e) => setForm({ ...form, odc_id: e.target.value, odp_id: "" })}
                disabled={modal?.mode === "edit"}
                required
              >
                <option value="" disabled>Pilih ODC…</option>
                {odcs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label={`Core ODC${formOdc ? ` (kabel ${getCableInfo(formOdc.cable_type)?.label ?? "-"})` : ""}`}>
              <input
                type="number" min={1} max={96} className="input" value={form.odc_core}
                onChange={(e) => setForm({ ...form, odc_core: e.target.value })}
                disabled={modal?.mode === "edit"}
                required
              />
            </Field>
            <Field label="ODP">
              <select
                className="input"
                value={form.odp_id}
                onChange={(e) => setForm({ ...form, odp_id: e.target.value })}
                disabled={modal?.mode === "edit" || !form.odc_id}
                required
              >
                <option value="" disabled>Pilih ODP…</option>
                {formOdps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Core ODP">
              <input
                type="number" min={1} max={96} className="input" value={form.odp_core}
                onChange={(e) => setForm({ ...form, odp_core: e.target.value })}
                disabled={modal?.mode === "edit"}
                required
              />
            </Field>
            <Field label="Redaman / Loss (dB) — opsional">
              <input
                type="number" step="0.01" className="input" value={form.loss_db}
                onChange={(e) => setForm({ ...form, loss_db: e.target.value })}
                placeholder="mis. 0.25"
              />
            </Field>
            <Field label="Catatan">
              <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="mis. Closure depan pasar" />
            </Field>
          </div>
          {modal?.mode === "add" && usedFormCores.length > 0 && (
            <p className="text-[11px] text-mut">
              Core ODC yang sudah tersambung di ODC ini: {usedFormCores.sort((a, b) => a - b).join(", ")} — satu core hanya boleh satu sambungan.
            </p>
          )}
          <button className="btn btn-primary w-full">Simpan Sambungan</button>
        </form>
      </Modal>

      <Toast toast={toastState} />
    </div>
  );
}
