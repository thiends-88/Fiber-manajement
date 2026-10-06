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
import { Plus, Trash2, Network, MapPin, Pencil, Cable, Search, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CABLE_TYPES, getCableInfo } from "@/lib/fiber";
import { CoreManager } from "@/components/CoreManager";
import { useIsAdmin, useCanWrite } from "@/hooks/useIsAdmin";

export const Route = createFileRoute("/_authenticated/odp")({
  head: () => ({ meta: [{ title: "ODP – FiberOps" }] }),
  component: OdpPage,
});

type ODP = {
  id: string; odc_id: string; name: string; location: string | null;
  cable_type: string; notes: string | null;
};

function OdpPage() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const canWrite = useCanWrite();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ODP | null>(null);
  const [form, setForm] = useState({ name: "", location: "", odc_id: "", cable_type: "12_core_2_tube", notes: "" });
  const [coreFor, setCoreFor] = useState<ODP | null>(null);
  const [search, setSearch] = useState("");

  const { data: odcs = [] } = useQuery({
    queryKey: ["odcs-lite"],
    queryFn: async () => (await supabase.from("odcs").select("id,name").order("name")).data ?? [],
  });
  const { data: odps = [] } = useQuery({
    queryKey: ["odps"],
    queryFn: async () => {
      const { data, error } = await supabase.from("odps").select("*").order("created_at");
      if (error) throw error;
      return data as ODP[];
    },
  });

  const upsert = useMutation({
    mutationFn: async () => {
      if (!form.name.trim() || !form.odc_id) throw new Error("Nama dan ODC wajib diisi");
      const payload = {
        name: form.name.trim(),
        location: form.location || null,
        odc_id: form.odc_id,
        cable_type: form.cable_type as never,
        notes: form.notes || null,
      };
      if (editing) {
        const { error } = await supabase.from("odps").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("odps").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "ODP diperbarui" : "ODP ditambahkan");
      qc.invalidateQueries({ queryKey: ["odps"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setOpen(false); setEditing(null);
      setForm({ name: "", location: "", odc_id: "", cable_type: "12_core_2_tube", notes: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("odps").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ODP dihapus");
      qc.invalidateQueries({ queryKey: ["odps"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });

  function openNew() {
    setEditing(null);
    setForm({ name: "", location: "", odc_id: odcs[0]?.id ?? "", cable_type: "12_core_2_tube", notes: "" });
    setOpen(true);
  }
  function openEdit(o: ODP) {
    setEditing(o);
    setForm({
      name: o.name, location: o.location ?? "", odc_id: o.odc_id,
      cable_type: o.cable_type, notes: o.notes ?? "",
    });
    setOpen(true);
  }

  const odcName = (id: string) => odcs.find((o) => o.id === id)?.name ?? "-";

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return odcs
      .map((odc) => ({
        odc,
        items: odps.filter((o) => {
          if (o.odc_id !== odc.id) return false;
          if (!q) return true;
          return (
            o.name.toLowerCase().includes(q) ||
            (o.location ?? "").toLowerCase().includes(q) ||
            odc.name.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [odcs, odps, search]);



  return (
    <AppLayout>
      <PageHeader
        title="ODP"
        description="Optical Distribution Point – titik distribusi ke pelanggan."
        actions={
          canWrite ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} disabled={odcs.length === 0}><Plus className="size-4" />Tambah ODP</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "Edit ODP" : "Tambah ODP"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>ODC Sumber</Label>
                  <Select value={form.odc_id} onValueChange={(v) => setForm({ ...form, odc_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Pilih ODC" /></SelectTrigger>
                    <SelectContent>
                      {odcs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Nama ODP</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ODP-A-01" />
                </div>
                <div>
                  <Label>Jenis Kabel (ODC → ODP)</Label>
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
          placeholder="Cari ODP, lokasi, atau ODC…"
          className="pl-9"
        />
      </div>

      {odcs.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">Tambahkan ODC dulu.</CardContent></Card>
      ) : odps.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">Belum ada ODP.</CardContent></Card>
      ) : groups.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">Tidak ada hasil untuk "{search}".</CardContent></Card>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.odc.id}>
              <div className="flex items-center gap-2 mb-3">
                <div className="size-8 rounded-md bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                  <Boxes className="size-4" />
                </div>
                <div className="font-semibold">{g.odc.name}</div>
                <Badge variant="secondary">{g.items.length} ODP</Badge>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {g.items.map((o) => {
            const info = getCableInfo(o.cable_type);
            return (
              <Card key={o.id} className="hover:border-primary/40">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="size-10 rounded-md bg-amber-500/15 text-amber-400 flex items-center justify-center">
                        <Network className="size-5" />
                      </div>
                      <div>
                        <div className="font-semibold">{o.name}</div>
                        <div className="text-xs text-muted-foreground">dari {odcName(o.odc_id)}</div>
                      </div>
                    </div>
                    {(canWrite || isAdmin) && (
                      <div className="flex gap-1">
                        {canWrite && (
                          <Button size="icon" variant="ghost" onClick={() => openEdit(o)}><Pencil className="size-4" /></Button>
                        )}
                        {isAdmin && (
                          <Button size="icon" variant="ghost" onClick={() => { if (confirm("Hapus ODP ini?")) del.mutate(o.id); }}><Trash2 className="size-4 text-red-400" /></Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5"><Cable className="size-3" /> {info?.label ?? o.cable_type}</div>
                    {o.location && <div className="flex items-center gap-1.5"><MapPin className="size-3" /> {o.location}</div>}
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
          parentName={`${coreFor.name} (dari ${odcName(coreFor.odc_id)})`}
          cableType={coreFor.cable_type}
          source="odc_to_odp"
          odpId={coreFor.id}
        />
      )}
    </AppLayout>
  );
}
