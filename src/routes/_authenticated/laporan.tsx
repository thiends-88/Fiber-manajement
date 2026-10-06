import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Download, FileText, Search } from "lucide-react";
import { getCableInfo, STATUS_LABEL } from "@/lib/fiber";

export const Route = createFileRoute("/_authenticated/laporan")({
  head: () => ({
    meta: [
      { title: "Laporan Jaringan Fiber – FiberOps" },
      { name: "description", content: "Rekap lengkap OLT, card & SFP, ODC, ODP, serta status core jaringan fiber optik." },
      { property: "og:title", content: "Laporan Jaringan Fiber – FiberOps" },
      { property: "og:description", content: "Rekap lengkap OLT, card & SFP, ODC, ODP, serta status core jaringan fiber optik." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportPage,
});

type Row = {
  id: string;
  name: string;
  parent?: string;
  location: string | null;
  extra: string;
  cable: string;
  tubes: number | string;
  totalCores: number;
  used: number;
  reserved: number;
  damaged: number;
  idle: number;
  children: number;
  notes: string | null;
};

function ReportPage() {
  const [scope, setScope] = useState<"olt" | "odc" | "odp">("odc");
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["report-all"],
    queryFn: async () => {
      const [olts, odcs, odps, cores, cards, ports, sources] = await Promise.all([
        supabase.from("olts").select("*").order("name"),
        supabase.from("odcs").select("*").order("name"),
        supabase.from("odps").select("*").order("name"),
        supabase.from("core_assignments").select("*"),
        supabase.from("olt_cards").select("*"),
        supabase.from("olt_ports").select("*"),
        supabase.from("odc_power_sources").select("*"),
      ]);
      return {
        olts: olts.data ?? [],
        odcs: odcs.data ?? [],
        odps: odps.data ?? [],
        cores: cores.data ?? [],
        cards: cards.data ?? [],
        ports: ports.data ?? [],
        sources: sources.data ?? [],
      };
    },
  });

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];

    const countBy = (list: typeof data.cores, status: string) =>
      list.filter((c) => c.status === status).length;

    if (scope === "olt") {
      return data.olts.map((o) => {
        const childOdcs = data.odcs.filter((x) => x.olt_id === o.id);
        const cards = data.cards.filter((c) => c.olt_id === o.id);
        const cardIds = new Set(cards.map((c) => c.id));
        const ports = data.ports.filter((p) => cardIds.has(p.card_id));
        const portsActive = ports.filter((p) => p.status === "active").length;
        const mine = data.cores.filter(
          (c) => c.source === "olt_to_odc" && childOdcs.some((cc) => cc.id === c.odc_id),
        );
        const totalCores = childOdcs.reduce((s, c) => s + (getCableInfo(c.cable_type)?.cores ?? 0), 0);
        return {
          id: o.id,
          name: o.name,
          location: o.location,
          extra: `${o.olt_type ?? "-"} · ${cards.length} card · ${ports.length} port (${portsActive} aktif)`,
          cable: "-",
          tubes: "-",
          totalCores,
          used: countBy(mine, "used"),
          reserved: countBy(mine, "reserved"),
          damaged: countBy(mine, "damaged"),
          idle: totalCores - mine.filter((c) => c.status !== "idle").length,
          children: childOdcs.length,
          notes: o.notes,
        };
      });
    }

    if (scope === "odc") {
      return data.odcs.map((o) => {
        const info = getCableInfo(o.cable_type);
        const total = info?.cores ?? 0;
        const mine = data.cores.filter((c) => c.source === "olt_to_odc" && c.odc_id === o.id);
        const srcPorts = data.sources.filter((s) => s.odc_id === o.id);
        const srcLabel = srcPorts
          .map((s) => {
            const port = data.ports.find((p) => p.id === s.port_id);
            const card = port ? data.cards.find((c) => c.id === port.card_id) : null;
            if (!port || !card) return null;
            return `${card.card_type} S${card.slot_number}/P${port.port_number}`;
          })
          .filter(Boolean)
          .join(", ");
        return {
          id: o.id,
          name: o.name,
          parent: data.olts.find((x) => x.id === o.olt_id)?.name ?? "-",
          location: o.location,
          extra: srcLabel || "-",
          cable: info?.label ?? o.cable_type,
          tubes: info?.tubes ?? "-",
          totalCores: total,
          used: countBy(mine, "used"),
          reserved: countBy(mine, "reserved"),
          damaged: countBy(mine, "damaged"),
          idle: total - mine.filter((c) => c.status !== "idle").length,
          children: data.odps.filter((p) => p.odc_id === o.id).length,
          notes: o.notes,
        };
      });
    }

    return data.odps.map((o) => {
      const info = getCableInfo(o.cable_type);
      const total = info?.cores ?? 0;
      const mine = data.cores.filter((c) => c.source === "odc_to_odp" && c.odp_id === o.id);
      const odc = data.odcs.find((x) => x.id === o.odc_id);
      const olt = odc ? data.olts.find((x) => x.id === odc.olt_id) : null;
      return {
        id: o.id,
        name: o.name,
        parent: odc?.name ?? "-",
        location: o.location,
        extra: olt?.name ?? "-",
        cable: info?.label ?? o.cable_type,
        tubes: info?.tubes ?? "-",
        totalCores: total,
        used: countBy(mine, "used"),
        reserved: countBy(mine, "reserved"),
        damaged: countBy(mine, "damaged"),
        idle: total - mine.filter((c) => c.status !== "idle").length,
        children: 0,
        notes: o.notes,
      };
    });
  }, [data, scope]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.parent, r.location, r.extra, r.cable].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const headers = useMemo(() => {
    const extraLabel = scope === "olt" ? "Perangkat & Card" : scope === "odc" ? "Port Sumber (OLT)" : "OLT Induk";
    const parentLabel = scope === "odc" ? "OLT Sumber" : "ODC Sumber";
    const childLabel = scope === "olt" ? "Jml ODC" : scope === "odc" ? "Jml ODP" : null;
    return { extraLabel, parentLabel, childLabel };
  }, [scope]);

  function buildTable() {
    const header = [
      "Nama",
      ...(scope !== "olt" ? [headers.parentLabel] : []),
      "Lokasi",
      headers.extraLabel,
      "Jenis Kabel",
      "Tube",
      "Total Core",
      "Terpakai",
      "Reserved",
      "Rusak",
      "Idle",
      ...(headers.childLabel ? [headers.childLabel] : []),
      "Utilisasi (%)",
      "Catatan",
    ];
    const body = filtered.map((r) => {
      const pct = r.totalCores ? Math.round((r.used / r.totalCores) * 100) : 0;
      return [
        r.name,
        ...(scope !== "olt" ? [r.parent ?? "-"] : []),
        r.location ?? "-",
        r.extra,
        r.cable,
        r.tubes,
        r.totalCores,
        r.used,
        r.reserved,
        r.damaged,
        Math.max(r.idle, 0),
        ...(headers.childLabel ? [r.children] : []),
        pct,
        r.notes ?? "-",
      ].map((v) => String(v));
    });
    return { header, body };
  }

  function exportCsv() {
    const { header, body } = buildTable();
    const lines = body.map((row) =>
      row.map((v) => `"${v.replace(/"/g, '""')}"`).join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-${scope}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const { header, body } = buildTable();
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const scopeLabel = scope === "olt" ? "Per OLT" : scope === "odc" ? "Per ODC" : "Per ODP";

    doc.setFontSize(14);
    doc.text(`Laporan Jaringan Fiber – ${scopeLabel}`, 40, 40);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      `Dicetak: ${new Date().toLocaleString("id-ID")}  ·  Total core: ${totals.total} · Terpakai: ${totals.used} · Idle: ${totals.idle} · Reserved: ${totals.reserved} · Rusak: ${totals.damaged}`,
      40,
      56,
    );

    autoTable(doc, {
      head: [header],
      body,
      startY: 70,
      styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      margin: { left: 40, right: 40 },
    });

    doc.save(`laporan-${scope}.pdf`);
  }


  const totals = useMemo(() => {
    const cores = data?.cores ?? [];
    return {
      total: cores.length,
      used: cores.filter((c) => c.status === "used").length,
      idle: cores.filter((c) => c.status === "idle").length,
      reserved: cores.filter((c) => c.status === "reserved").length,
      damaged: cores.filter((c) => c.status === "damaged").length,
    };
  }, [data]);

  return (
    <AppLayout>
      <PageHeader
        title="Laporan"
        description="Rekap lengkap perangkat dan penggunaan core sesuai data input OLT, ODC, dan ODP."
        actions={
          <div className="flex gap-2">
            <Select value={scope} onValueChange={(v) => setScope(v as "olt" | "odc" | "odp")}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="olt">Per OLT</SelectItem>
                <SelectItem value="odc">Per ODC</SelectItem>
                <SelectItem value="odp">Per ODP</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" onClick={exportCsv}><Download className="size-4" /> CSV</Button>
            <Button onClick={exportPdf}><FileText className="size-4" /> PDF</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {(["total", "used", "idle", "reserved", "damaged"] as const).map((k) => (
          <Card key={k}>
            <CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">
                {k === "total" ? "Total Core Tercatat" : STATUS_LABEL[k]?.label ?? k}
              </div>
              <div className="text-2xl font-bold mt-1">{totals[k]}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-4 relative">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama, lokasi, induk, atau jenis kabel…"
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Nama</th>
                {scope !== "olt" && <th className="text-left p-3">{headers.parentLabel}</th>}
                <th className="text-left p-3">Lokasi</th>
                <th className="text-left p-3">{headers.extraLabel}</th>
                <th className="text-left p-3">Jenis Kabel</th>
                <th className="text-right p-3">Tube</th>
                <th className="text-right p-3">Total Core</th>
                <th className="text-right p-3">Terpakai</th>
                <th className="text-right p-3">Reserved</th>
                <th className="text-right p-3">Rusak</th>
                <th className="text-right p-3">Idle</th>
                {headers.childLabel && <th className="text-right p-3">{headers.childLabel}</th>}
                <th className="text-right p-3">Utilisasi</th>
                <th className="text-left p-3">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={14} className="p-10 text-center text-muted-foreground">
                    {search ? `Tidak ada hasil untuk "${search}".` : "Belum ada data."}
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const pct = r.totalCores ? Math.round((r.used / r.totalCores) * 100) : 0;
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                    <td className="p-3 font-medium">{r.name}</td>
                    {scope !== "olt" && <td className="p-3 text-muted-foreground">{r.parent}</td>}
                    <td className="p-3 text-muted-foreground">{r.location ?? "-"}</td>
                    <td className="p-3 text-muted-foreground max-w-[240px] truncate" title={r.extra}>{r.extra}</td>
                    <td className="p-3 text-muted-foreground">{r.cable}</td>
                    <td className="p-3 text-right text-muted-foreground">{r.tubes}</td>
                    <td className="p-3 text-right">{r.totalCores}</td>
                    <td className="p-3 text-right text-emerald-500">{r.used}</td>
                    <td className="p-3 text-right text-amber-500">{r.reserved}</td>
                    <td className="p-3 text-right text-red-500">{r.damaged}</td>
                    <td className="p-3 text-right text-muted-foreground">{Math.max(r.idle, 0)}</td>
                    {headers.childLabel && <td className="p-3 text-right">{r.children}</td>}
                    <td className="p-3 text-right">
                      <Badge className={pct > 80 ? "bg-red-500/15 text-red-500" : pct > 50 ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500"}>
                        {pct}%
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground max-w-[200px] truncate" title={r.notes ?? ""}>{r.notes ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
