import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { Plus, Trash2, Server, MapPin, Pencil, Cpu } from "lucide-react";
import { toast } from "sonner";
import { OLT_TYPES } from "@/lib/fiber";
import { OltCardManager, OltCardBadges } from "@/components/OltCardManager";
import { useIsAdmin, useCanWrite } from "@/hooks/useIsAdmin";

export const Route = createFileRoute("/_authenticated/olt")({
  head: () => ({ meta: [{ title: "OLT – FiberOps" }] }),
  component: OltPage,
});

type OLT = {
  id: string; name: string; location: string | null; notes: string | null;
  olt_type: string | null;
};

function OltPage() {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const canWrite = useCanWrite();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OLT | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", location: "", notes: "",
    olt_type: "ZTE C320", olt_type_other: "",
  });

  const { data: olts = [] } = useQuery({
    queryKey: ["olts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("olts").select("*").order("created_at");
      if (error) throw error;
      return data as OLT[];
    },
  });

  const upsert = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Nama OLT wajib diisi");
      const oltType = form.olt_type === "Lainnya"
        ? (form.olt_type_other.trim() || null)
        : form.olt_type;
      const payload = {
        name: form.name.trim(),
        location: form.location || null,
        notes: form.notes || null,
        olt_type: oltType,
      };
      if (editing) {
        const { error } = await supabase.from("olts").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("olts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "OLT diperbarui" : "OLT ditambahkan");
      qc.invalidateQueries({ queryKey: ["olts"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setOpen(false); setEditing(null);
      setForm({ name: "", location: "", notes: "", olt_type: "ZTE C320", olt_type_other: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("olts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OLT dihapus");
      qc.invalidateQueries({ queryKey: ["olts"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setForm({ name: "", location: "", notes: "", olt_type: "ZTE C320", olt_type_other: "" });
    setOpen(true);
  }
  function openEdit(o: OLT) {
    setEditing(o);
    const known = OLT_TYPES.includes(o.olt_type as (typeof OLT_TYPES)[number]);
    setForm({
      name: o.name, location: o.location ?? "", notes: o.notes ?? "",
      olt_type: o.olt_type ? (known ? o.olt_type : "Lainnya") : "ZTE C320",
      olt_type_other: o.olt_type && !known ? o.olt_type : "",
    });
    setOpen(true);
  }

  const managingOlt = olts.find((o) => o.id === managingId) ?? null;

  return (
    <AppLayout>
      <PageHeader
        title="OLT"
        description="Optical Line Terminal – titik awal jaringan fiber. Kelola jenis perangkat, card terpasang, dan SFP per port."
        actions={
          canWrite ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}><Plus className="size-4" />Tambah OLT</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit OLT" : "Tambah OLT"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Nama OLT</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="OLT-CENTRAL-01" />
                </div>
                <div>
                  <Label>Jenis OLT</Label>
                  <Select value={form.olt_type} onValueChange={(v) => setForm({ ...form, olt_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OLT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.olt_type === "Lainnya" && (
                    <Input
                      className="mt-2"
                      placeholder="Ketik jenis OLT lain…"
                      value={form.olt_type_other}
                      onChange={(e) => setForm({ ...form, olt_type_other: e.target.value })}
                    />
                  )}
                </div>
                <div>
                  <Label>Lokasi</Label>
                  <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="STO Jakarta Pusat" />
                </div>
                <div>
                  <Label>Catatan</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
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

      {olts.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">Belum ada OLT. Klik "Tambah OLT" untuk membuat.</CardContent></Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {olts.map((o) => (
            <Card key={o.id} className="hover:border-primary/40 transition-colors">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="size-10 rounded-md bg-primary/15 text-primary flex items-center justify-center">
                      <Server className="size-5" />
                    </div>
                    <div>
                      <div className="font-semibold">{o.name}</div>
                      {o.olt_type && (
                        <Badge variant="outline" className="text-[10px] mt-0.5">{o.olt_type}</Badge>
                      )}
                      {o.location && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <MapPin className="size-3" />{o.location}
                        </div>
                      )}
                    </div>
                  </div>
                  {(canWrite || isAdmin) && (
                    <div className="flex gap-1">
                      {canWrite && (
                        <Button size="icon" variant="ghost" onClick={() => openEdit(o)}><Pencil className="size-4" /></Button>
                      )}
                      {isAdmin && (
                        <Button size="icon" variant="ghost" onClick={() => { if (confirm("Hapus OLT ini beserta semua ODC/ODP di bawahnya?")) del.mutate(o.id); }}><Trash2 className="size-4 text-red-400" /></Button>
                      )}
                    </div>
                  )}
                </div>
                {o.notes && <p className="text-xs text-muted-foreground mt-3">{o.notes}</p>}
                <OltCardBadges oltId={o.id} />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-3"
                  onClick={() => setManagingId(o.id)}>
                  <Cpu className="size-4" />Kelola Card & SFP
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={managingOlt != null} onOpenChange={(v) => !v && setManagingId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Card & SFP · {managingOlt?.name}
              {managingOlt?.olt_type && (
                <Badge variant="outline" className="ml-2 text-[10px]">{managingOlt.olt_type}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {managingOlt && <OltCardManager oltId={managingOlt.id} />}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
