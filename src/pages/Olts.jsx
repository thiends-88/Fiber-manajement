import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Badge, Card, Empty, Field, Modal, PageHeader, Toast, useToast } from "../components/ui.jsx";
import { CARD_TYPES, OLT_TYPES, PORT_STATUS } from "../lib/fiber.js";

const emptyOlt = { name: "", olt_type: OLT_TYPES[0], location: "", ip: "", notes: "" };
const emptyCard = { slot: "", card_type: "GTGO", label: "", port_count: 8, notes: "" };
const emptyPort = { port: "", sfp: "", serial: "", status: "inactive", notes: "" };

export default function Olts() {
  const { user } = useAuth();
  const canWrite = user.role === "admin" || user.role === "operator";

  const [olts, setOlts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [cards, setCards] = useState([]);
  const [ports, setPorts] = useState([]);
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);

  const [oltModal, setOltModal] = useState(null); // null | {mode:'add'} | {mode:'edit', olt}
  const [cardModal, setCardModal] = useState(null);
  const [portModal, setPortModal] = useState(null);
  const [form, setForm] = useState(emptyOlt);
  const [cardForm, setCardForm] = useState(emptyCard);
  const [portForm, setPortForm] = useState(emptyPort);

  const loadOlts = useCallback(() => api("/api/olts").then(setOlts), []);
  const loadCards = useCallback(
    (oltId) =>
      api(`/api/cards?olt_id=${oltId}`).then((cs) => {
        setCards(cs);
        return cs;
      }),
    [],
  );
  const loadPorts = useCallback(
    async (cardIds) => {
      if (!cardIds.length) return setPorts([]);
      const all = await api("/api/ports");
      setPorts(all.filter((p) => cardIds.includes(p.card_id)));
    },
    [],
  );

  useEffect(() => {
    loadOlts().catch((e) => toast(e.message, "error"));
  }, [loadOlts, toast]);

  useEffect(() => {
    if (!selectedId) {
      setCards([]);
      setPorts([]);
      return;
    }
    loadCards(selectedId)
      .then((cs) => loadPorts(cs.map((c) => c.id)))
      .catch((e) => toast(e.message, "error"));
  }, [selectedId, loadCards, loadPorts, toast]);

  async function saveOlt(e) {
    e.preventDefault();
    try {
      if (oltModal.mode === "add") await api("/api/olts", { method: "POST", body: form });
      else await api(`/api/olts/${oltModal.olt.id}`, { method: "PATCH", body: { ...oltModal.olt, ...form } });
      setOltModal(null);
      await loadOlts();
      toast("OLT tersimpan");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function deleteOlt(olt) {
    if (!confirm(`Hapus OLT "${olt.name}" beserta seluruh card, port, ODC, dan ODP di bawahnya?`)) return;
    try {
      await api(`/api/olts/${olt.id}`, { method: "DELETE" });
      if (selectedId === olt.id) setSelectedId(null);
      await loadOlts();
      toast("OLT dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function saveCard(e) {
    e.preventDefault();
    try {
      if (cardModal.mode === "add") await api("/api/cards", { method: "POST", body: { ...cardForm, olt_id: selectedId, slot: Number(cardForm.slot), port_count: Number(cardForm.port_count) } });
      else await api(`/api/cards/${cardModal.card.id}`, { method: "PATCH", body: { ...cardModal.card, ...cardForm, slot: Number(cardForm.slot), port_count: Number(cardForm.port_count) } });
      setCardModal(null);
      await loadCards(selectedId).then((cs) => loadPorts(cs.map((c) => c.id)));
      toast("Card tersimpan");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function deleteCard(card) {
    if (!confirm(`Hapus card slot ${card.slot} beserta port-portnya?`)) return;
    try {
      await api(`/api/cards/${card.id}`, { method: "DELETE" });
      await loadCards(selectedId).then((cs) => loadPorts(cs.map((c) => c.id)));
      toast("Card dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function savePort(e) {
    e.preventDefault();
    try {
      if (portModal.mode === "add") await api("/api/ports", { method: "POST", body: { ...portForm, card_id: portModal.cardId, port: Number(portForm.port) } });
      else await api(`/api/ports/${portModal.port.id}`, { method: "PATCH", body: { ...portModal.port, ...portForm, port: Number(portForm.port) } });
      setPortModal(null);
      const cs = await loadCards(selectedId);
      await loadPorts(cs.map((c) => c.id));
      toast("Port tersimpan");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function deletePort(portRow) {
    if (!confirm(`Hapus port ${portRow.port}?`)) return;
    try {
      await api(`/api/ports/${portRow.id}`, { method: "DELETE" });
      const cs = await loadCards(selectedId);
      await loadPorts(cs.map((c) => c.id));
      toast("Port dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  const selectedOlt = olts.find((o) => o.id === selectedId);

  return (
    <div>
      <PageHeader title="Manajemen OLT" desc="Kelola perangkat OLT beserta card dan port GPON-nya.">
        {canWrite && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setForm(emptyOlt);
              setOltModal({ mode: "add" });
            }}
          >
            <Plus size={15} /> Tambah OLT
          </button>
        )}
      </PageHeader>

      <Card className="overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Nama</th>
              <th className="th">Tipe</th>
              <th className="th">Lokasi</th>
              <th className="th">IP</th>
              <th className="th">Card</th>
              <th className="th">ODC</th>
              {canWrite && <th className="th">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {olts.map((o) => (
              <tr
                key={o.id}
                className={`cursor-pointer border-b border-line-soft last:border-0 hover:bg-panel2 ${
                  o.id === selectedId ? "bg-panel2" : ""
                }`}
                onClick={() => setSelectedId(o.id === selectedId ? null : o.id)}
              >
                <td className="td font-medium">
                  <span className="mr-2 inline-block text-acc"><Server size={14} /></span>
                  {o.name}
                </td>
                <td className="td text-mut">{o.olt_type || "-"}</td>
                <td className="td text-mut">{o.location || "-"}</td>
                <td className="td text-mut">{o.ip || "-"}</td>
                <td className="td">{o.card_count}</td>
                <td className="td">{o.odc_count}</td>
                {canWrite && (
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button
                        className="btn px-2 py-1"
                        onClick={() => {
                          setForm({ name: o.name, olt_type: o.olt_type || OLT_TYPES[0], location: o.location || "", ip: o.ip || "", notes: o.notes || "" });
                          setOltModal({ mode: "edit", olt: o });
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button className="btn px-2 py-1 text-red-400" onClick={() => deleteOlt(o)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {olts.length === 0 && (
              <tr>
                <td className="td py-8 text-center text-mut" colSpan={7}>Belum ada OLT.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {selectedOlt && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Card & Port — <span className="text-acc">{selectedOlt.name}</span>
            </h2>
            {canWrite && (
              <button
                className="btn text-xs"
                onClick={() => {
                  setCardForm(emptyCard);
                  setCardModal({ mode: "add" });
                }}
              >
                <Plus size={13} /> Tambah Card
              </button>
            )}
          </div>
          {cards.length === 0 && <Empty text="Belum ada card pada OLT ini." />}
          <div className="grid gap-4 lg:grid-cols-2">
            {cards.map((c) => {
              const cardPorts = ports.filter((p) => p.card_id === c.id);
              const ct = CARD_TYPES.find((t) => t.value === c.card_type);
              return (
                <Card key={c.id}>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Slot {c.slot} — {c.label || ct?.label || c.card_type}</div>
                      <div className="text-xs text-mut">{c.port_count} port · {cardPorts.length} tercatat</div>
                    </div>
                    {canWrite && (
                      <div className="flex gap-1">
                        <button
                          className="btn px-2 py-1"
                          onClick={() => {
                            setCardForm({ slot: c.slot, card_type: c.card_type, label: c.label || "", port_count: c.port_count, notes: c.notes || "" });
                            setCardModal({ mode: "edit", card: c });
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button className="btn px-2 py-1 text-red-400" onClick={() => deleteCard(c)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mb-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
                    {Array.from({ length: c.port_count }, (_, i) => i + 1).map((n) => {
                      const pr = cardPorts.find((p) => p.port === n);
                      const st = pr ? PORT_STATUS[pr.status] : null;
                      return (
                        <button
                          key={n}
                          disabled={!canWrite}
                          title={pr ? `Port ${n}: ${st.label}${pr.sfp ? ` · ${pr.sfp}` : ""}` : `Port ${n}: belum tercatat`}
                          onClick={() => {
                            if (pr) {
                              setPortForm({ port: pr.port, sfp: pr.sfp || "", serial: pr.serial || "", status: pr.status, notes: pr.notes || "" });
                              setPortModal({ mode: "edit", port: pr });
                            } else {
                              setPortForm({ ...emptyPort, port: n });
                              setPortModal({ mode: "add", cardId: c.id });
                            }
                          }}
                          className={`flex h-9 items-center justify-center rounded-md border text-xs font-semibold transition ${
                            pr
                              ? pr.status === "active"
                                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                                : pr.status === "reserved"
                                  ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                                  : pr.status === "damaged"
                                    ? "border-red-500/50 bg-red-500/15 text-red-300"
                                    : "border-line bg-panel2 text-mut"
                              : "border-dashed border-line text-mut-soft hover:border-acc"
                          }`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                  {cardPorts.length > 0 && (
                    <table className="w-full">
                      <thead>
                        <tr className="border-t border-line">
                          <th className="th">Port</th>
                          <th className="th">SFP</th>
                          <th className="th">Serial</th>
                          <th className="th">Status</th>
                          {canWrite && <th className="th" />}
                        </tr>
                      </thead>
                      <tbody>
                        {cardPorts.map((pr) => (
                          <tr key={pr.id} className="border-t border-line-soft">
                            <td className="td font-semibold">{pr.port}</td>
                            <td className="td text-mut">{pr.sfp || "-"}</td>
                            <td className="td text-mut">{pr.serial || "-"}</td>
                            <td className="td">
                              <Badge cls={PORT_STATUS[pr.status].cls}>{PORT_STATUS[pr.status].label}</Badge>
                            </td>
                            {canWrite && (
                              <td className="td text-right">
                                <button className="text-red-400 hover:text-red-300" onClick={() => deletePort(pr)}>
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <Modal open={!!oltModal} title={oltModal?.mode === "add" ? "Tambah OLT" : "Edit OLT"} onClose={() => setOltModal(null)}>
        <form onSubmit={saveOlt} className="space-y-3">
          <Field label="Nama OLT">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Tipe OLT">
            <select className="input" value={form.olt_type} onChange={(e) => setForm({ ...form, olt_type: e.target.value })}>
              {OLT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Lokasi">
            <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </Field>
          <Field label="Alamat IP">
            <input className="input" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} />
          </Field>
          <Field label="Catatan">
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <button className="btn btn-primary w-full">Simpan</button>
        </form>
      </Modal>

      <Modal open={!!cardModal} title={cardModal?.mode === "add" ? "Tambah Card" : "Edit Card"} onClose={() => setCardModal(null)}>
        <form onSubmit={saveCard} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nomor Slot">
              <input className="input" type="number" min={1} value={cardForm.slot} onChange={(e) => setCardForm({ ...cardForm, slot: e.target.value })} required />
            </Field>
            <Field label="Jumlah Port">
              <input className="input" type="number" min={1} max={32} value={cardForm.port_count} onChange={(e) => setCardForm({ ...cardForm, port_count: e.target.value })} required />
            </Field>
          </div>
          <Field label="Tipe Card">
            <select
              className="input"
              value={cardForm.card_type}
              onChange={(e) => {
                const ct = CARD_TYPES.find((t) => t.value === e.target.value);
                setCardForm({ ...cardForm, card_type: e.target.value, port_count: cardForm.port_count || ct?.defaultPorts || 8 });
              }}
            >
              {CARD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Label Card">
            <input className="input" value={cardForm.label} onChange={(e) => setCardForm({ ...cardForm, label: e.target.value })} />
          </Field>
          <button className="btn btn-primary w-full">Simpan</button>
        </form>
      </Modal>

      <Modal open={!!portModal} title={portModal?.mode === "add" ? `Tambah Port ${portForm.port}` : `Edit Port ${portModal?.port.port}`} onClose={() => setPortModal(null)}>
        <form onSubmit={savePort} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nomor Port">
              <input className="input" type="number" min={1} value={portForm.port} onChange={(e) => setPortForm({ ...portForm, port: e.target.value })} required />
            </Field>
            <Field label="Status">
              <select className="input" value={portForm.status} onChange={(e) => setPortForm({ ...portForm, status: e.target.value })}>
                {Object.entries(PORT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Model SFP">
            <input className="input" value={portForm.sfp} onChange={(e) => setPortForm({ ...portForm, sfp: e.target.value })} />
          </Field>
          <Field label="Serial SFP">
            <input className="input" value={portForm.serial} onChange={(e) => setPortForm({ ...portForm, serial: e.target.value })} />
          </Field>
          <Field label="Catatan">
            <textarea className="input" rows={2} value={portForm.notes} onChange={(e) => setPortForm({ ...portForm, notes: e.target.value })} />
          </Field>
          <button className="btn btn-primary w-full">Simpan</button>
        </form>
      </Modal>

      <Toast toast={toastState} />
    </div>
  );
}
