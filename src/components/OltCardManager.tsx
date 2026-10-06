import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { CARD_TYPES, PORT_STATUS_LABEL, type CardTypeValue } from "@/lib/fiber";
import { Plus, Trash2, Pencil, Cpu } from "lucide-react";
import { toast } from "sonner";
import { useIsAdmin, useCanWrite } from "@/hooks/useIsAdmin";

type OltCard = {
  id: string;
  olt_id: string;
  slot_number: number;
  card_type: CardTypeValue;
  card_label: string | null;
  port_count: number;
  notes: string | null;
};

type OltPort = {
  id: string;
  card_id: string;
  port_number: number;
  sfp_model: string | null;
  sfp_serial: string | null;
  sfp_tx_power: string | null;
  status: "active" | "inactive" | "reserved" | "damaged";
  notes: string | null;
};

export function OltCardManager({ oltId }: { oltId: string }) {
  const qc = useQueryClient();
  const isAdmin = useIsAdmin();
  const canWrite = useCanWrite();
  const [openCard, setOpenCard] = useState(false);
  const [editingCard, setEditingCard] = useState<OltCard | null>(null);
  const [cardForm, setCardForm] = useState({
    slot_number: "1",
    card_type: "GTGO" as CardTypeValue,
    card_label: "",
    port_count: "8",
    notes: "",
  });

  const { data: cards = [] } = useQuery({
    queryKey: ["olt_cards", oltId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("olt_cards").select("*").eq("olt_id", oltId).order("slot_number");
      if (error) throw error;
      return data as OltCard[];
    },
  });

  const upsertCard = useMutation({
    mutationFn: async () => {
      const payload = {
        olt_id: oltId,
        slot_number: parseInt(cardForm.slot_number) || 1,
        card_type: cardForm.card_type,
        card_label: cardForm.card_label || null,
        port_count: parseInt(cardForm.port_count) || 8,
        notes: cardForm.notes || null,
      };
      if (editingCard) {
        const { error } = await supabase.from("olt_cards").update(payload).eq("id", editingCard.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("olt_cards").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingCard ? "Card diperbarui" : "Card ditambahkan");
      qc.invalidateQueries({ queryKey: ["olt_cards", oltId] });
      setOpenCard(false); setEditingCard(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delCard = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("olt_cards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Card dihapus");
      qc.invalidateQueries({ queryKey: ["olt_cards", oltId] });
    },
  });

  function openNewCard() {
    setEditingCard(null);
    setCardForm({
      slot_number: String((cards.at(-1)?.slot_number ?? 0) + 1),
      card_type: "GTGO",
      card_label: "",
      port_count: "8",
      notes: "",
    });
    setOpenCard(true);
  }

  function openEditCard(c: OltCard) {
    setEditingCard(c);
    setCardForm({
      slot_number: String(c.slot_number),
      card_type: c.card_type,
      card_label: c.card_label ?? "",
      port_count: String(c.port_count),
      notes: c.notes ?? "",
    });
    setOpenCard(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {cards.length} card terpasang · {cards.reduce((s, c) => s + c.port_count, 0)} total port
        </div>
        {canWrite && (
        <Dialog open={openCard} onOpenChange={setOpenCard}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNewCard}><Plus className="size-4" />Tambah Card</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCard ? "Edit Card" : "Tambah Card"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Slot</Label>
                  <Input type="number" min={1}
                    value={cardForm.slot_number}
                    onChange={(e) => setCardForm({ ...cardForm, slot_number: e.target.value })} />
                </div>
                <div>
                  <Label>Jenis Card</Label>
                  <Select
                    value={cardForm.card_type}
                    onValueChange={(v) => {
                      const t = CARD_TYPES.find((c) => c.value === v);
                      setCardForm({
                        ...cardForm,
                        card_type: v as CardTypeValue,
                        port_count: String(t?.defaultPorts ?? cardForm.port_count),
                      });
                    }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CARD_TYPES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Jumlah Port</Label>
                  <Input type="number" min={1} max={64}
                    value={cardForm.port_count}
                    onChange={(e) => setCardForm({ ...cardForm, port_count: e.target.value })} />
                </div>
                <div>
                  <Label>Label (opsional)</Label>
                  <Input value={cardForm.card_label}
                    placeholder="mis. Card-A"
                    onChange={(e) => setCardForm({ ...cardForm, card_label: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Catatan</Label>
                <Textarea rows={2} value={cardForm.notes}
                  onChange={(e) => setCardForm({ ...cardForm, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpenCard(false)}>Batal</Button>
              <Button onClick={() => upsertCard.mutate()} disabled={upsertCard.isPending}>Simpan</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {cards.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-md">
          Belum ada card. Tambahkan card GTGO / GTGH terpasang di OLT ini.
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded bg-primary/15 text-primary flex items-center justify-center">
                      <Cpu className="size-4" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">
                        Slot {c.slot_number} · {c.card_type}
                        {c.card_label && <span className="text-muted-foreground"> · {c.card_label}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{c.port_count} port</div>
                    </div>
                  </div>
                  {(canWrite || isAdmin) && (
                    <div className="flex gap-1">
                      {canWrite && (
                        <Button size="icon" variant="ghost" onClick={() => openEditCard(c)}>
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button size="icon" variant="ghost"
                          onClick={() => { if (confirm("Hapus card ini beserta semua port-nya?")) delCard.mutate(c.id); }}>
                          <Trash2 className="size-4 text-red-400" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <PortsGrid card={c} canEdit={canWrite} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PortsGrid({ card, canEdit }: { card: OltCard; canEdit: boolean }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState({
    sfp_model: "", sfp_serial: "", sfp_tx_power: "",
    status: "inactive" as OltPort["status"], notes: "",
  });

  const { data: ports = [] } = useQuery({
    queryKey: ["olt_ports", card.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("olt_ports").select("*").eq("card_id", card.id).order("port_number");
      if (error) throw error;
      return data as OltPort[];
    },
  });

  const portByNum = new Map(ports.map((p) => [p.port_number, p]));

  const upsertPort = useMutation({
    mutationFn: async () => {
      if (selected == null) return;
      const existing = portByNum.get(selected);
      const payload = {
        card_id: card.id,
        port_number: selected,
        sfp_model: form.sfp_model || null,
        sfp_serial: form.sfp_serial || null,
        sfp_tx_power: form.sfp_tx_power || null,
        status: form.status,
        notes: form.notes || null,
      };
      if (existing) {
        const { error } = await supabase.from("olt_ports").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("olt_ports").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Port disimpan");
      qc.invalidateQueries({ queryKey: ["olt_ports", card.id] });
      setSelected(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openPort(n: number) {
    const p = portByNum.get(n);
    setForm({
      sfp_model: p?.sfp_model ?? "",
      sfp_serial: p?.sfp_serial ?? "",
      sfp_tx_power: p?.sfp_tx_power ?? "",
      status: p?.status ?? "inactive",
      notes: p?.notes ?? "",
    });
    setSelected(n);
  }

  return (
    <div>
      <div className="grid grid-cols-8 gap-1.5">
        {Array.from({ length: card.port_count }, (_, i) => i + 1).map((n) => {
          const p = portByNum.get(n);
          const st = PORT_STATUS_LABEL[p?.status ?? "inactive"];
          return (
            <button key={n} type="button" onClick={() => openPort(n)}
              title={p?.sfp_model ? `Port ${n} · ${p.sfp_model}` : `Port ${n}`}
              className={`h-11 rounded-md text-[10px] font-medium border transition-colors hover:border-primary ${st.className}`}>
              <div>P{n}</div>
              {p?.sfp_model && <div className="truncate px-1 opacity-80">SFP</div>}
            </button>
          );
        })}
      </div>

      <Dialog open={selected != null} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Port {selected} · Slot {card.slot_number} ({card.card_type})</DialogTitle>
          </DialogHeader>
          <fieldset disabled={!canEdit} className="space-y-3 disabled:opacity-70">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Model SFP</Label>
                <Input value={form.sfp_model} placeholder="mis. C+ / C++ / B+"
                  onChange={(e) => setForm({ ...form, sfp_model: e.target.value })} />
              </div>
              <div>
                <Label>Serial SFP</Label>
                <Input value={form.sfp_serial}
                  onChange={(e) => setForm({ ...form, sfp_serial: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>TX Power</Label>
                <Input value={form.sfp_tx_power} placeholder="mis. +3 dBm"
                  onChange={(e) => setForm({ ...form, sfp_tx_power: e.target.value })} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as OltPort["status"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PORT_STATUS_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Catatan</Label>
              <Textarea rows={2} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </fieldset>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)}>Tutup</Button>
            {canEdit && (
              <Button onClick={() => upsertPort.mutate()} disabled={upsertPort.isPending}>Simpan</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function OltCardBadges({ oltId }: { oltId: string }) {
  const { data: cards = [] } = useQuery({
    queryKey: ["olt_cards", oltId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("olt_cards").select("*").eq("olt_id", oltId).order("slot_number");
      if (error) throw error;
      return data as OltCard[];
    },
  });
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {cards.map((c) => (
        <Badge key={c.id} variant="secondary" className="text-[10px]">
          S{c.slot_number} {c.card_type}·{c.port_count}p
        </Badge>
      ))}
    </div>
  );
}
