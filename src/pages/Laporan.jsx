import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../lib/api.js";
import { Badge, Card, Empty, PageHeader } from "../components/ui.jsx";
import { STATUS, getCableInfo } from "../lib/fiber.js";

export default function Laporan() {
  const [rows, setRows] = useState(null);
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");

  useEffect(() => {
    api("/api/laporan").then(setRows).catch(() => setRows([]));
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter(
      (r) => (source === "all" || r.source === source) && (status === "all" || r.status === status),
    );
  }, [rows, source, status]);

  function exportCsv() {
    const head = ["Sumber", "Link", "Uplink", "Kabel", "Core", "Status", "Pelanggan", "Tujuan", "Catatan"];
    const lines = [
      head.join(";"),
      ...filtered.map((r) =>
        [
          r.source === "olt_to_odc" ? "OLT → ODC" : "ODC → ODP",
          r.link_name ?? "",
          r.uplink_name ?? "",
          getCableInfo(r.cable_type)?.label ?? r.cable_type ?? "",
          r.core,
          STATUS[r.status]?.label ?? r.status,
          r.customer ?? "",
          r.destination ?? "",
          r.notes ?? "",
        ]
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(";"),
      ),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `laporan-core-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <PageHeader title="Laporan Core" desc="Rekap penugasan core seluruh jaringan.">
        <button className="btn" onClick={exportCsv} disabled={!filtered.length}>
          <Download size={15} /> Ekspor CSV
        </button>
      </PageHeader>

      <Card className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <label className="label">Segmen</label>
          <select className="input w-48" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">Semua</option>
            <option value="olt_to_odc">OLT → ODC</option>
            <option value="odc_to_odp">ODC → ODP</option>
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Semua</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="ml-auto text-sm text-mut">{filtered.length} baris</div>
      </Card>

      <Card className="overflow-x-auto p-0">
        {!rows ? (
          <div className="p-6 text-sm text-mut">Memuat…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6"><Empty text="Tidak ada data sesuai filter." /></div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-line">
              <tr>
                <th className="th">Segmen</th>
                <th className="th">Link</th>
                <th className="th">Uplink</th>
                <th className="th">Kabel</th>
                <th className="th">Core</th>
                <th className="th">Status</th>
                <th className="th">Pelanggan</th>
                <th className="th">Tujuan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-line/50 last:border-0">
                  <td className="td text-mut">{r.source === "olt_to_odc" ? "OLT → ODC" : "ODC → ODP"}</td>
                  <td className="td font-medium">{r.link_name ?? "-"}</td>
                  <td className="td text-mut">{r.uplink_name ?? "-"}</td>
                  <td className="td text-mut">{getCableInfo(r.cable_type)?.label ?? "-"}</td>
                  <td className="td font-semibold">{r.core}</td>
                  <td className="td"><Badge cls={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge></td>
                  <td className="td text-mut">{r.customer || "-"}</td>
                  <td className="td text-mut">{r.destination || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
