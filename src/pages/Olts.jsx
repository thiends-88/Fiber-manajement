import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { INTERFACE_MODES, defaultInterfaceMode, interfaceDetails, interfaceLabel, interfaceLink, interfaceMode } from "../lib/interfaces.js";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Badge, Card, Empty, Field, Modal, PageHeader, SearchBox, Toast, matchesQuery, useToast } from "../components/ui.jsx";
import { CARD_TYPES, OLT_TYPES, PORT_STATUS } from "../lib/fiber.js";

const emptyOlt = { interface_mode: "shelf_slot_port", fixed_port_count: 8, name: "", olt_type: OLT_TYPES[0], location: "", ip: "", notes: "" };
const emptyCard = { shelf: 1, slot: "", card_type: "GTGO", label: "", port_count: 8, notes: "" };
const emptyPort = { interface_name: "", port: "", sfp: "", serial: "", status: "inactive", notes: "" };

export default function Olts() {
  const { user } = useAuth();
  const canWrite = user.role === "admin" || user.role === "operator";

  const [params, setParams] = useSearchParams();
  const submitBusy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [olts, setOlts] = useState([]);
  const [query, setQuery] = useState("");
  const selectedId = Number(params.get("olt")) || null;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const setSelectedId = (id) => setParams(id ? { olt: String(id) } : {});
  const [cards, setCards] = useState([]);
  const [cardsLoading, setCardsLoading] = useState(false);
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
        if (selectedIdRef.current === Number(oltId)) setCards(cs);
        return cs;
      }),
    [],
  );
  const loadPorts = useCallback(
    async (cardIds, oltId) => {
      if (!cardIds.length) { if (selectedIdRef.current === Number(oltId)) setPorts([]); return; }
      const all = await api("/api/ports");
      if (selectedIdRef.current === Number(oltId)) setPorts(all.filter((p) => cardIds.includes(p.card_id)));
    },
    [],
  );

  useEffect(() => {
    loadOlts().catch((e) => toast(e.message, "error"));
  }, [loadOlts, toast]);

  useEffect(() => {
    let active = true;
    setCardModal(null); setPortModal(null);
    setCards([]); setPorts([]);
    if (!selectedId) { setCardsLoading(false); return; }
    setCardsLoading(true);
    Promise.all([api(`/api/cards?olt_id=${selectedId}`), api(`/api/ports?olt_id=${selectedId}`)])
      .then(([cs, ps]) => { if (active) { setCards(cs); setPorts(ps); } })
      .catch((e) => { if (active) toast(e.message, "error"); })
      .finally(() => { if (active) setCardsLoading(false); });
    return () => { active = false; };
  }, [selectedId, toast]);

  async function saveOlt(e) {
    e.preventDefault();
    if (submitBusy.current) return;
    submitBusy.current = true; setSaving(true);
    try {
      const saved = oltModal.mode === "add" ? await api("/api/olts", { method: "POST", body: form })
        : await api(`/api/olts/${oltModal.olt.id}`, { method: "PATCH", body: form });
      setSelectedId(saved.id);
      setOltModal(null);
      await loadOlts();
      // Jumlah port bawaan dapat berubah lewat Edit OLT.
      if (saved.id) await loadCards(saved.id).then((cs) => loadPorts(cs.map((c) => c.id), saved.id));
      toast("OLT tersimpan");
    } catch (err) {
      toast(err.message, "error");
    } finally { submitBusy.current = false; setSaving(false); }
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
    if (submitBusy.current) return;
    if (cardModal.mode === "edit" && (Number(cardForm.shelf) !== cardModal.card.shelf || Number(cardForm.slot) !== cardModal.card.slot)
      && !confirm("Mengubah shelf/slot juga mengubah nama semua interface pada card ini. Pastikan sesuai posisi card fisik. Lanjutkan?")) return;
    submitBusy.current = true; setSaving(true);
    try {
      if (cardModal.mode === "add") await api("/api/cards", { method: "POST", body: { ...cardForm, olt_id: selectedId, shelf: Number(cardForm.shelf), slot: Number(cardForm.slot), port_count: Number(cardForm.port_count) } });
      else await api(`/api/cards/${cardModal.card.id}`, { method: "PATCH", body: { ...cardModal.card, ...cardForm, shelf: Number(cardForm.shelf), slot: Number(cardForm.slot), port_count: Number(cardForm.port_count) } });
      setCardModal(null);
      await loadCards(selectedId).then((cs) => loadPorts(cs.map((c) => c.id), selectedId));
      await loadOlts();
      toast("Card tersimpan");
    } catch (err) {
      toast(err.message, "error");
    } finally { submitBusy.current = false; setSaving(false); }
  }

  async function deleteCard(card) {
    if (!confirm(`Hapus card slot ${card.slot} beserta port-portnya?`)) return;
    try {
      await api(`/api/cards/${card.id}`, { method: "DELETE" });
      await loadCards(selectedId).then((cs) => loadPorts(cs.map((c) => c.id), selectedId));
      await loadOlts();
      toast("Card dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function savePort(e) {
    e.preventDefault();
    if (submitBusy.current) return;
    if (portModal.mode === "edit" && (Number(portForm.port) !== portModal.port.port || portForm.interface_name !== (portModal.port.interface_name || ""))
      && !confirm("Perubahan nomor/nama interface berlaku juga pada jalur yang memakainya. Pastikan sesuai port fisik. Lanjutkan?")) return;
    submitBusy.current = true; setSaving(true);
    try {
      if (portModal.mode === "add") await api("/api/ports", { method: "POST", body: { ...portForm, card_id: portModal.cardId, port: Number(portForm.port) } });
      else await api(`/api/ports/${portModal.port.id}`, { method: "PATCH", body: { ...portModal.port, ...portForm, port: Number(portForm.port) } });
      setPortModal(null);
      const cs = await loadCards(selectedId);
      await loadPorts(cs.map((c) => c.id), selectedId);
      await loadOlts();
      toast("Interface tersimpan");
    } catch (err) {
      toast(err.message, "error");
    } finally { submitBusy.current = false; setSaving(false); }
  }

  async function deletePort(portRow) {
    if (!confirm(`Hapus ${interfaceLabel(portRow)}? Port yang masih dipetakan ke core harus dilepas mapping-nya terlebih dahulu.`)) return;
    try {
      await api(`/api/ports/${portRow.id}`, { method: "DELETE" });
      const cs = await loadCards(selectedId);
      await loadPorts(cs.map((c) => c.id), selectedId);
      await loadOlts();
      toast("Port dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  const selectedOlt = olts.find((o) => o.id === selectedId);
  const shownOlts = olts.filter((o) => matchesQuery(query, o.name, o.olt_type, o.location, o.ip));
  const portCardId = portModal?.mode === "add" ? portModal.cardId : portModal?.port?.card_id;
  const selectedCard = cards.find((c) => c.id === portCardId);
  const portLimit = selectedCard?.port_count ?? 32;
  const mode = interfaceMode(selectedOlt || {});
  const portPreview = interfaceDetails({ ...selectedCard, ...portForm }, selectedOlt || {});

  return (
    <div>
      <PageHeader title="Manajemen OLT" desc="Catat interface sesuai port fisik OLT. ZTE C300/C320 memakai shelf / slot / port; OLT fixed-port bisa memakai PON langsung.">
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

      <div className="mb-4 rounded-lg border border-line bg-panel2 px-3 py-2 text-xs text-mut">Urutan pencatatan: <strong className="text-ink">1. Pilih OLT → 2. Tambah card (ZTE) → 3. Klik port untuk mencatat interface</strong>. Setelah itu, pilih feeder di ODC dan petakan interface ke core pada <Link className="text-acc underline" to="/mapping">Mapping Core</Link>.</div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Cari OLT (nama, tipe, lokasi, IP)…"
          className="w-full sm:max-w-xs"
        />
        {query && (
          <span className="text-xs text-mut">{shownOlts.length} dari {olts.length} OLT</span>
        )}
      </div>

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
            {shownOlts.map((o) => (
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
                <td className="td">{o.card_count}<div className="text-[10px] text-mut">{o.interface_count || 0} interface</div></td>
                <td className="td">{o.odc_count}</td>
                {canWrite && (
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button
                        className="btn px-2 py-1"
                        title={`Edit OLT ${o.name}`}
                        onClick={() => {
                          setForm({ interface_mode: interfaceMode(o), fixed_port_count: o.fixed_port_count || 8, name: o.name, olt_type: o.olt_type ?? "", location: o.location || "", ip: o.ip || "", notes: o.notes || "" });
                          setOltModal({ mode: "edit", olt: o });
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button className="btn px-2 py-1 text-red-400" title={`Hapus OLT ${o.name}`} onClick={() => deleteOlt(o)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {shownOlts.length === 0 && (
              <tr>
                <td className="td py-8 text-center text-mut" colSpan={canWrite ? 7 : 6}>
                  {olts.length === 0 ? "Belum ada OLT." : `Tidak ada OLT yang cocok dengan "${query}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {selectedOlt && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Interface OLT — <span className="text-acc">{selectedOlt.name}</span>
            </h2>
            {canWrite && mode === "shelf_slot_port" && (
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
          <p className="mb-3 text-xs text-mut">{mode === "shelf_slot_port" ? "Contoh GPON 1/2/1: shelf 1, slot/card 2, port 1. Shelf card lama dimulai dari 1; periksa kembali sesuai perangkat. Jumlah port mengikuti card terpasang, bukan jumlah slot chassis." : "Port bawaan langsung tersedia di bawah. Jumlah port diatur melalui Edit OLT; tidak perlu membuat card."} Status port dicatat manual, bukan hasil monitoring otomatis.</p>
          {cardsLoading && <p className="mb-3 text-xs text-mut">Memuat interface OLT…</p>}
          {!cardsLoading && cards.length === 0 && <Empty text="Belum ada card pada OLT ini. Tambah card sesuai shelf dan slot fisiknya." />}
          <div className="grid gap-4 lg:grid-cols-2">
            {cards.map((c) => {
              const cardPorts = ports.filter((p) => p.card_id === c.id);
              const ct = CARD_TYPES.find((t) => t.value === c.card_type);
              return (
                <Card key={c.id}>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{c.is_builtin ? "Port bawaan OLT" : `Shelf ${c.shelf} · Slot ${c.slot} — ${c.label || ct?.label || c.card_type}`}</div>
                      <div className="text-xs text-mut">{c.port_count} port · {cardPorts.length} tercatat</div>
                    </div>
                    {canWrite && !c.is_builtin && (
                      <div className="flex gap-1">
                        <button
                          className="btn px-2 py-1"
                          title={`Edit card shelf ${c.shelf} slot ${c.slot}`}
                          onClick={() => {
                            setCardForm({ shelf: c.shelf, slot: c.slot, card_type: c.card_type, label: c.label || "", port_count: c.port_count, notes: c.notes || "" });
                            setCardModal({ mode: "edit", card: c });
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button className="btn px-2 py-1 text-red-400" title={`Hapus card shelf ${c.shelf} slot ${c.slot}`} onClick={() => deleteCard(c)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {Array.from({ length: c.port_count }, (_, i) => i + 1).map((n) => {
                      const pr = cardPorts.find((p) => p.port === n);
                      const st = pr ? PORT_STATUS[pr.status] : null;
                      const name = mode === "custom" && !pr ? `Port ${n}` : interfaceDetails({ ...c, port: n, ...pr }, selectedOlt).interface_label;
                      return (
                        <button
                          key={n}
                          disabled={!canWrite}
                          title={pr ? `${name}: ${st.label}${pr.sfp ? ` · ${pr.sfp}` : ""} — klik untuk mengubah` : `${name}: klik untuk mencatat interface`}
                          onClick={() => {
                            if (pr) {
                              setPortForm({ interface_name: pr.interface_name || "", port: pr.port, sfp: pr.sfp || "", serial: pr.serial || "", status: pr.status, notes: pr.notes || "" });
                              setPortModal({ mode: "edit", port: pr });
                            } else {
                              setPortForm({ ...emptyPort, port: n });
                              setPortModal({ mode: "add", cardId: c.id });
                            }
                          }}
                          className={`flex min-h-11 break-all px-1 py-2 items-center justify-center rounded-md border text-xs font-semibold transition ${
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
                          {name}
                        </button>
                      );
                    })}
                  </div>
                  {cardPorts.length > 0 && (
                    <div className="overflow-x-auto"><table className="w-full">
                      <thead>
                        <tr className="border-t border-line">
                          <th className="th">Interface</th>
                          <th className="th">SFP</th>
                          <th className="th">Serial</th>
                          <th className="th">Status</th>
                          {canWrite && <th className="th" />}
                        </tr>
                      </thead>
                      <tbody>
                        {cardPorts.map((pr) => (
                          <tr key={pr.id} className="border-t border-line-soft">
                            <td className="td font-semibold"><Link className="text-cyan-300 hover:underline" to={interfaceLink(pr)} title="Lihat jalur sampai ODP">{interfaceLabel(pr)}</Link><div className="text-[10px] font-normal text-mut">Lihat jalur →</div></td>
                            <td className="td text-mut">{pr.sfp || "-"}</td>
                            <td className="td text-mut">{pr.serial || "-"}</td>
                            <td className="td">
                              <Badge cls={PORT_STATUS[pr.status].cls}>{PORT_STATUS[pr.status].label}</Badge>
                            </td>
                            {canWrite && (
                              <td className="td text-right">
                                <button className="text-red-400 hover:text-red-300" title={`Hapus ${interfaceLabel(pr)}`} onClick={() => deletePort(pr)}>
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <Modal busy={saving} open={!!oltModal} title={oltModal?.mode === "add" ? "Tambah OLT" : "Edit OLT"} onClose={() => { if (!saving) setOltModal(null); }}>
        <form onSubmit={saveOlt}><fieldset disabled={saving} className="space-y-3">
          <Field label="Nama OLT">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Tipe OLT">
            <select className="input" value={form.olt_type} onChange={(e) => setForm({ ...form, olt_type: e.target.value, interface_mode: oltModal?.mode === "add" ? defaultInterfaceMode(e.target.value) : form.interface_mode })}>
              {!OLT_TYPES.includes(form.olt_type) && <option value={form.olt_type}>{form.olt_type || "Model belum diisi"}</option>}
              {OLT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Format interface">
            <select aria-label="Format interface" className="input" value={form.interface_mode} onChange={(e) => setForm({ ...form, interface_mode: e.target.value })}>
              {INTERFACE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-mut">{INTERFACE_MODES.find((m) => m.value === form.interface_mode)?.hint}</p>
            {oltModal?.mode === "edit" && <p className="mt-1 text-[11px] text-mut">Format port yang sudah tercatat tidak dapat diganti agar jalur lama tetap aman. Mengganti tipe perangkat tidak otomatis mengganti formatnya.</p>}
          </Field>
          {form.interface_mode !== "shelf_slot_port" && <Field label="Jumlah port PON bawaan"><input aria-label="Jumlah port PON bawaan" className="input" type="number" min={1} max={128} required value={form.fixed_port_count} onChange={(e) => setForm({ ...form, fixed_port_count: e.target.value })} /></Field>}
          <Field label="Lokasi">
            <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </Field>
          <Field label="Alamat IP">
            <input className="input" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} />
          </Field>
          <Field label="Catatan">
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <button className="btn btn-primary w-full" disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</button>
        </fieldset></form>
      </Modal>

      <Modal busy={saving} open={!!cardModal} title={cardModal?.mode === "add" ? "Tambah Card" : "Edit Card"} onClose={() => { if (!saving) setCardModal(null); }}>
        <form onSubmit={saveCard}><fieldset disabled={saving} className="space-y-3">
          <Field label="Nomor Shelf"><input aria-label="Nomor Shelf" className="input" type="number" min={1} max={256} value={cardForm.shelf} onChange={(e) => setCardForm({ ...cardForm, shelf: e.target.value })} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nomor Slot">
              <input className="input" type="number" min={1} max={256} value={cardForm.slot} onChange={(e) => setCardForm({ ...cardForm, slot: e.target.value })} required />
            </Field>
            <Field label="Jumlah Port">
              <input className="input" type="number" min={1} max={32} value={cardForm.port_count} onChange={(e) => setCardForm({ ...cardForm, port_count: e.target.value })} required />
            </Field>
          </div>
          <p className="text-xs text-mut">Contoh interface: GPON {cardForm.shelf || "?"}/{cardForm.slot || "?"}/1. Isi berdasarkan posisi card sebenarnya, bukan urutan card yang dicatat.</p>
          <Field label="Tipe Card">
            <select
              className="input"
              value={cardForm.card_type}
              onChange={(e) => {
                const ct = CARD_TYPES.find((t) => t.value === e.target.value);
                setCardForm({ ...cardForm, card_type: e.target.value, port_count: cardForm.port_count || ct?.defaultPorts || 8 });
              }}
            >
              {!CARD_TYPES.some((t) => t.value === cardForm.card_type) && <option value={cardForm.card_type}>{cardForm.card_type || "Tipe belum diisi"} (tersimpan)</option>}
              {CARD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Label Card">
            <input className="input" value={cardForm.label} onChange={(e) => setCardForm({ ...cardForm, label: e.target.value })} />
          </Field>
          <button className="btn btn-primary w-full" disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</button>
        </fieldset></form>
      </Modal>

      <Modal busy={saving} open={!!portModal} title={portModal?.mode === "add" ? "Catat Interface OLT" : "Edit Interface OLT"} onClose={() => { if (!saving) setPortModal(null); }}>
        <form onSubmit={savePort} className="space-y-3">
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs">
            <div className="break-words font-semibold">{selectedOlt?.name} / {portPreview.interface_label}</div>
            {portPreview.interface_cli && <code className="mt-1 block break-words text-mut">{portPreview.interface_cli}</code>}
          </div>
          {mode === "custom" && <Field label="Nama interface sesuai perangkat"><input aria-label="Nama interface sesuai perangkat" className="input" required maxLength={64} value={portForm.interface_name} onChange={(e) => setPortForm({ ...portForm, interface_name: e.target.value })} placeholder="Mis. EPON0/1" /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nomor Port">
              <input aria-label="Nomor Port" className="input" type="number" min={1} max={portLimit} value={portForm.port} onChange={(e) => setPortForm({ ...portForm, port: e.target.value })} required />
            </Field>
            <Field label="Status tercatat">
              <select aria-label="Status tercatat" className="input" value={portForm.status} onChange={(e) => setPortForm({ ...portForm, status: e.target.value })}>
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
          <button className="btn btn-primary w-full" disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</button>
        </form>
      </Modal>

      <Toast toast={toastState} />
    </div>
  );
}
