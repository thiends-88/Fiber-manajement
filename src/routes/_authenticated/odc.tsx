import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Boxes, MapPin, Pencil, Cable, Zap, X, Search, Server } from "lucide-react";
import { toast } from "sonner";
import { CABLE_TYPES, getCableInfo } from "@/lib/fiber";
import { CoreManager } from "@/components/CoreManager";
import { useIsAdmin, useCanWrite } from "@/hooks/useIsAdmin";

export const Route = createFileRoute("/_authenticated/odc")({
  head: () => ({ meta: [{ title: "ODC – FiberOps" }] }),
  component: OdcPage,
});

type ODC = {
  id: string; olt_id: string; name: string; location: string | null;
  cable_type: string; notes: string | null;
};
type OltCardRow = { id: string; olt_id: string; slot_number: number; card_type: string; card_label: string | null };
type OltPortRow = { id: string; card_id: string; port_number: number };

function OdcPage() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const canWrite = useCanWrite();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ODC | null>(null);
  const [form, setForm] = useState({ name: "", location: "", olt_id: "", cable_type: "24_core_2_tube", notes: "" });
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [selectedPortIds, setSelectedPortIds] = useState<string[]>([]);
  const [pendingPortId, setPendingPortId] = useState<string>("");
  const [coreFor, setCoreFor] = useState<ODC | null>(null);
  const [search, setSearch] = useState("");

  const { data: olts = [] } = useQuery({
    queryKey: ["olts"],
    queryFn: async () => (await supabase.from("olts").select("id,name,olt_type").order("name")).data ?? [],
  });
  const { data: odcs = [] } = useQuery({
    queryKey: ["odcs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("odcs").select("*").order("created_at");
      if (error) throw error;
      return data as ODC[];
    },
  });

  // Semua card & port untuk OLT terpilih di form
  const { data: cards = [] } = useQuery({
    queryKey: ["olt_cards", form.olt_id],
    enabled: !!form.olt_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("olt_cards").select("id,olt_id,slot_number,card_type,card_label")
        .eq("olt_id", form.olt_id).order("slot_number");
      if (error) throw error;
      return data as OltCardRow[];
    },
  });
  const cardIds = useMemo(() => cards.map((c) => c.id), [cards]);
  const { data: ports = [] } = useQuery({
    queryKey: ["olt_ports_for_olt", form.olt_id, cardIds.join(",")],
    enabled: cardIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("olt_ports").select("id,card_id,port_number")
        .in("card_id", cardIds).order("port_number");
      if (error) throw error;
      return data as OltPortRow[];
    },
  });

  // Sumber daya untuk semua ODC (untuk ditampilkan di kartu)
  const { data: allSources = [] } = useQuery({
    queryKey: ["odc_power_sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("odc_power_sources").select("id,odc_id,port_id");
      if (error) throw error;
      return data as { id: string; odc_id: string; port_id: string }[];
    },
  });

  const upsert = useMutation({
    mutationFn: async () => {
      if (!form.name.trim() || !form.olt_id) throw new Error("Nama dan OLT wajib diisi");
      const payload = {
        name: form.name.trim(),
        location: form.location || null,
        olt_id: form.olt_id,
        cable_type: form.cable_type as never,
        notes: form.notes || null,
      };
      let odcId: string;
      if (editing) {
        const { error } = await supabase.from("odcs").update(payload).eq("id", editing.id);
        if (error) throw error;
        odcId = editing.id;
      } else {
        const { data, error } = await supabase.from("odcs").insert(payload).select("id").single();
        if (error) throw error;
        odcId = data.id;
      }
      // Sinkronisasi power sources
      const { error: delErr } = await supabase.from("odc_power_sources").delete().eq("odc_id", odcId);
      if (delErr) throw delErr;
      if (selectedPortIds.length > 0) {
        const rows = selectedPortIds.map((port_id) => ({ odc_id: odcId, port_id }));
        const { error: insErr } = await supabase.from("odc_power_sources").insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "ODC diperbarui" : "ODC ditambahkan");
      qc.invalidateQueries({ queryKey: ["odcs"] });
      qc.invalidateQueries({ queryKey: ["odc_power_sources"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setOpen(false); setEditing(null);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("odcs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ODC dihapus");
      qc.invalidateQueries({ queryKey: ["odcs"] });
      qc.invalidateQueries({ queryKey: ["odc_power_sources"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });

  function resetForm() {
    setForm({ name: "", location: "", olt_id: "", cable_type: "24_core_2_tube", notes: "" });
    setSelectedCardId("");
    setSelectedPortIds([]);
    setPendingPortId("");
  }

  function openNew() {
    setEditing(null);
    resetForm();
    setForm((f) => ({ ...f, olt_id: olts[0]?.id ?? "" }));
    setOpen(true);
  }
  async function openEdit(o: ODC) {
    setEditing(o);
    setForm({
      name: o.name, location: o.location ?? "", olt_id: o.olt_id,
      cable_type: o.cable_type, notes: o.notes ?? "",
    });
    setSelectedCardId("");
    setPendingPortId("");
    // Load existing sources
    const { data } = await supabase.from("odc_power_sources").select("port_id").eq("odc_id", o.id);
    setSelectedPortIds((data ?? []).map((r) => r.port_id));
    setOpen(true);
  }

  const oltName = (id: string) => olts.find((o) => o.id === id)?.name ?? "-";

  // Ports pada card terpilih, kecuali yang sudah dipilih
  const availablePorts = useMemo(() => {
    if (!selectedCardId) return [];
    return ports.filter((p) => p.card_id === selectedCardId && !selectedPortIds.includes(p.id));
  }, [ports, selectedCardId, selectedPortIds]);

  function portLabel(portId: string) {
    const p = ports.find((x) => x.id === portId);
    if (!p) return "?";
    const c = cards.find((x) => x.id === p.card_id);
    return `Slot ${c?.slot_number ?? "?"} · ${c?.card_type ?? "-"} · Port ${p.port_number}`;
  }

  function addPendingPort() {
    if (!pendingPortId) return;
    setSelectedPortIds((prev) => [...prev, pendingPortId]);
    setPendingPortId("");
  }

  function removePort(id: string) {
    setSelectedPortIds((prev) => prev.filter((x) => x !== id));
  }

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return olts
      .map((olt) => ({
        olt,
        items: odcs.filter((o) => {
          if (o.olt_id !== olt.id) return false;
          if (!q) return true;
          return (
            o.name.toLowerCase().includes(q) ||
            (o.location ?? "").toLowerCase().includes(q) ||
            olt.name.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [olts, odcs, search]);



  return (
    <AppLayout>
      <PageHeader
        title="ODC"
        description="Optical Distribution Cabinet – terhubung dari OLT dengan kabel feeder."
        actions={
          canWrite ? (
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); resetForm(); } }}>
            <DialogTrigger asChild>
              <Button onClick={openNew} disabled={olts.length === 0}><Plus className="size-4" />Tambah ODC</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editing ? "Edit ODC" : "Tambah ODC"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>OLT Sumber</Label>
                  <Select
                    value={form.olt_id}
                    onValueChange={(v) => {
                      setForm({ ...form, olt_id: v });
                      setSelectedCardId("");
                      setSelectedPortIds([]);
                      setPendingPortId("");
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Pilih OLT" /></SelectTrigger>
                    <SelectContent>
                      {olts.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Card OLT</Label>
                  <Select
                    value={selectedCardId}
                    onValueChange={(v) => { setSelectedCardId(v); setPendingPortId(""); }}
                    disabled={!form.olt_id || cards.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={cards.length === 0 ? "Belum ada card di OLT ini" : "Pilih card"} />
                    </SelectTrigger>
                    <SelectContent>
                      {cards.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          Slot {c.slot_number} · {c.card_type}{c.card_label ? ` · ${c.card_label}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Port Sumber (bisa lebih dari satu)</Label>
                  <div className="flex gap-2">
                    <Select
                      value={pendingPortId}
                      onValueChange={setPendingPortId}
                      disabled={!selectedCardId || availablePorts.length === 0}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={
                          !selectedCardId ? "Pilih card dulu"
                            : availablePorts.length === 0 ? "Semua port sudah dipilih"
                              : "Pilih port"
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        {availablePorts.map((p) => (
                          <SelectItem key={p.id} value={p.id}>Port {p.port_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="secondary" onClick={addPendingPort} disabled={!pendingPortId}>
                      <Plus className="size-4" />Tambah
                    </Button>
                  </div>
                  {selectedPortIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {selectedPortIds.map((pid) => (
                        <Badge key={pid} variant="secondary" className="gap-1 pr-1">
                          <Zap className="size-3" />
                          {portLabel(pid)}
                          <button
                            type="button"
                            onClick={() => removePort(pid)}
                            className="ml-1 rounded hover:bg-background/60 p-0.5"
                            aria-label="Hapus port"
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <Label>Nama ODC</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ODC-A" />
                </div>
                <div>
                  <Label>Jenis Kabel (OLT → ODC)</Label>
                  <Select value={form.cable_type} onValueChange={(v) => setForm({ ...form, cable_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CABLE_TYPES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Lokasi</Label>
                  <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </div>
                <div>
                  <Label>Catatan</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Batal</Button>
                <Button onClick={() => upsert.mutate()} disabled={upsert.isPending}>Simpan</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          ) : null
        }
      />

      <div className="mb-4 relative">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari ODC, lokasi, atau OLT…"
          className="pl-9"
        />
      </div>

      {olts.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">Tambahkan OLT dulu di halaman OLT.</CardContent></Card>
      ) : odcs.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">Belum ada ODC.</CardContent></Card>
      ) : groups.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">Tidak ada hasil untuk "{search}".</CardContent></Card>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.olt.id}>
              <div className="flex items-center gap-2 mb-3">
                <div className="size-8 rounded-md bg-primary/15 text-primary flex items-center justify-center">
                  <Server className="size-4" />
                </div>
                <div className="font-semibold">{g.olt.name}</div>
                <Badge variant="secondary">{g.items.length} ODC</Badge>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {g.items.map((o) => {
            const info = getCableInfo(o.cable_type);
            const sourceCount = allSources.filter((s) => s.odc_id === o.id).length;
            return (
              <Card key={o.id} className="hover:border-primary/40">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="size-10 rounded-md bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                        <Boxes className="size-5" />
                      </div>
                      <div>
                        <div className="font-semibold">{o.name}</div>
                        <div className="text-xs text-muted-foreground">dari {oltName(o.olt_id)}</div>
                      </div>
                    </div>
                    {(canWrite || isAdmin) && (
                      <div className="flex gap-1">
                        {canWrite && (
                          <Button size="icon" variant="ghost" onClick={() => openEdit(o)}><Pencil className="size-4" /></Button>
                        )}
                        {isAdmin && (
                          <Button size="icon" variant="ghost" onClick={() => { if (confirm("Hapus ODC ini beserta ODP di bawahnya?")) del.mutate(o.id); }}><Trash2 className="size-4 text-red-400" /></Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5"><Cable className="size-3" /> {info?.label ?? o.cable_type}</div>
                    {o.location && <div className="flex items-center gap-1.5"><MapPin className="size-3" /> {o.location}</div>}
                    <div className="flex items-center gap-1.5"><Zap className="size-3" /> {sourceCount} port sumber</div>
                  </div>
                  <Button variant="secondary" size="sm" className="w-full mt-4" onClick={() => setCoreFor(o)}>
                    <Cable className="size-4" /> Kelola Core ({info?.cores ?? "?"})
                  </Button>
                </CardContent>
              </Card>
            );
                })}
              </div>
            </section>
          ))}
        </div>
      )}


      {coreFor && (
        <CoreManager
          open={!!coreFor}
          onOpenChange={(v) => !v && setCoreFor(null)}
          parentName={`${coreFor.name} (dari ${oltName(coreFor.olt_id)})`}
          cableType={coreFor.cable_type}
          source="olt_to_odc"
          odcId={coreFor.id}
        />
      )}
    </AppLayout>
  );
}
