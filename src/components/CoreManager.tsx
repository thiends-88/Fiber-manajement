import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Cable } from "lucide-react";
import { colorForTube, getCableInfo, coresPerTube as cptFor, colorForCoreInCable, tubeForCoreInCable, STATUS_LABEL } from "@/lib/fiber";
import { toast } from "sonner";
import { useIsAdmin, useCanWrite } from "@/hooks/useIsAdmin";

type CoreAssignment = {
  id: string;
  source: "olt_to_odc" | "odc_to_odp";
  odc_id: string | null;
  odp_id: string | null;
  core_number: number;
  color: string;
  tube_number: number | null;
  status: "idle" | "used" | "reserved" | "damaged";
  customer: string | null;
  destination: string | null;
  notes: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parentName: string;
  cableType: string;
  source: "olt_to_odc" | "odc_to_odp";
  odcId?: string;
  odpId?: string;
}

export function CoreManager({ open, onOpenChange, parentName, cableType, source, odcId, odpId }: Props) {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const canWrite = useCanWrite();
  const cable = getCableInfo(cableType);
  const totalCores = cable?.cores ?? 12;
  const perTube = cptFor(cableType);
  const colorForCore = (n: number) => colorForCoreInCable(n, perTube);
  const tubeForCore = (n: number) => tubeForCoreInCable(n, perTube);

  const queryKey = ["cores", source, odcId ?? odpId];

  const { data: assignments = [] } = useQuery({
    queryKey,
    enabled: open,
    queryFn: async () => {
      let q = supabase.from("core_assignments").select("*").eq("source", source);
      if (source === "olt_to_odc" && odcId) q = q.eq("odc_id", odcId).is("odp_id", null);
      if (source === "odc_to_odp" && odpId) q = q.eq("odp_id", odpId);
      const { data, error } = await q.order("core_number");
      if (error) throw error;
      return data as CoreAssignment[];
    },
  });

  const map = useMemo(() => {
    const m = new Map<number, CoreAssignment>();
    assignments.forEach((a) => m.set(a.core_number, a));
    return m;
  }, [assignments]);

  const [selectedCore, setSelectedCore] = useState<number | null>(null);
  const selectedAssign = selectedCore != null ? map.get(selectedCore) ?? null : null;
  const [form, setForm] = useState({
    status: "used" as CoreAssignment["status"],
    customer: "",
    destination: "",
    notes: "",
  });

  function openCore(n: number) {
    setSelectedCore(n);
    const a = map.get(n);
    setForm({
      status: a?.status ?? "used",
      customer: a?.customer ?? "",
      destination: a?.destination ?? "",
      notes: a?.notes ?? "",
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      if (selectedCore == null) return;
      const color = colorForCore(selectedCore).name;
      const tube_number = tubeForCore(selectedCore);
      const payload = {
        source,
        odc_id: source === "olt_to_odc" ? odcId ?? null : null,
        odp_id: source === "odc_to_odp" ? odpId ?? null : null,
        core_number: selectedCore,
        color,
        tube_number,
        status: form.status,
        customer: form.customer || null,
        destination: form.destination || null,
        notes: form.notes || null,
      };
      if (selectedAssign) {
        const { error } = await supabase.from("core_assignments").update(payload).eq("id", selectedAssign.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("core_assignments").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Core disimpan");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setSelectedCore(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!selectedAssign) return;
      const { error } = await supabase.from("core_assignments").delete().eq("id", selectedAssign.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Assignment dihapus");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setSelectedCore(null);
    },
  });

  const tubes = cable?.tubes ?? 1;
  const coresPerTube = perTube;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cable className="size-4 text-primary" />
            Manajemen Core — {parentName}
          </DialogTitle>
          <div className="text-xs text-muted-foreground">
            Kabel: <span className="font-medium">{cable?.label ?? cableType}</span> · Total {totalCores} core
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {Array.from({ length: tubes }).map((_, tIdx) => {
            const tubeNum = tIdx + 1;
            const start = tIdx * coresPerTube + 1;
            const end = Math.min(start + coresPerTube - 1, totalCores);
            return (
              <div key={tubeNum}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="inline-block w-4 h-4 rounded-full border border-border/60"
                    style={{ backgroundColor: colorForTube(tubeNum).hex }}
                    title={`Tube ${tubeNum} - ${colorForTube(tubeNum).name}`}
                  />
                  <span className="text-xs font-medium text-muted-foreground">
                    Tube {tubeNum} · {colorForTube(tubeNum).name}
                  </span>
                </div>
                <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
                  {Array.from({ length: end - start + 1 }, (_, i) => start + i).map((n) => {
                    const a = map.get(n);
                    const c = colorForCore(n);
                    const isDark = ["#111827", "#78350f", "#2563eb", "#8b5cf6", "#dc2626"].includes(c.hex);
                    return (
                      <button
                        key={n}
                        onClick={() => openCore(n)}
                        className={`relative aspect-square rounded-md border-2 text-[10px] font-medium flex flex-col items-center justify-center transition-all hover:scale-105 ${
                          a ? "border-primary" : "border-border/60 opacity-80"
                        }`}
                        style={{
                          backgroundColor: c.hex,
                          color: isDark ? "#fff" : "#111",
                        }}
                        title={`Core ${n} - ${c.name}${a ? ` · ${a.status}` : ""}`}
                      >
                        <span className="font-bold text-xs">{n}</span>
                        <span className="text-[8px] opacity-80">{c.name}</span>
                        {a && (
                          <span
                            className={`absolute -top-1 -right-1 size-3 rounded-full border border-background ${
                              a.status === "used"
                                ? "bg-emerald-500"
                                : a.status === "reserved"
                                ? "bg-amber-500"
                                : a.status === "damaged"
                                ? "bg-red-500"
                                : "bg-muted"
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {selectedCore != null && (
          <div className="mt-4 border-t border-border pt-4 space-y-3">
            <div className="flex items-center gap-3">
              <div
                className="size-10 rounded-md border-2 border-border flex items-center justify-center font-bold"
                style={{
                  backgroundColor: colorForCore(selectedCore).hex,
                  color: ["#111827","#78350f","#2563eb","#8b5cf6","#dc2626"].includes(colorForCore(selectedCore).hex) ? "#fff" : "#111",
                }}
              >
                {selectedCore}
              </div>
              <div>
                <div className="font-semibold">Core #{selectedCore} — {colorForCore(selectedCore).name}</div>
                <div className="text-xs text-muted-foreground">Tube {tubeForCore(selectedCore)}</div>
              </div>
              {selectedAssign && (
                <Badge className={STATUS_LABEL[selectedAssign.status].className}>
                  {STATUS_LABEL[selectedAssign.status].label}
                </Badge>
              )}
            </div>

            <fieldset disabled={!canWrite} className="grid md:grid-cols-2 gap-3 disabled:opacity-70">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as CoreAssignment["status"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="idle">Idle</SelectItem>
                    <SelectItem value="used">Terpakai</SelectItem>
                    <SelectItem value="reserved">Reserved</SelectItem>
                    <SelectItem value="damaged">Rusak</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-1" />
              <div className="md:col-span-2">
                <Label>Tujuan / Port</Label>
                <Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="ODP-A / Port 3 / Alamat" />
              </div>
              <div className="md:col-span-2">
                <Label>Catatan</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </fieldset>

            <div className="flex justify-between gap-2">
              <div>
                {isAdmin && selectedAssign && (
                  <Button variant="ghost" className="text-red-400 hover:text-red-500" onClick={() => remove.mutate()}>
                    Hapus assignment
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setSelectedCore(null)}>Tutup</Button>
                {canWrite && (
                  <Button onClick={() => save.mutate()} disabled={save.isPending}>Simpan</Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
