import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, Route } from "lucide-react";
import { Badge, Card, Empty } from "./ui.jsx";
import { CoreChip } from "./JalurCore.jsx";
import InterfaceBadge from "./InterfaceBadge.jsx";
import { interfaceLabel, interfaceLink } from "../lib/interfaces.js";
import { PORT_STATUS } from "../lib/fiber.js";

export default function InterfaceReport({ items, summary, unconnectedCount = 0 }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Ringkasan laporan interface">
        {[
          ["interfaces", "Interface", summary.interfaces], ["odcs", "ODC unik", summary.odcs],
          ["odps", "ODP unik", summary.odps], ["unmapped", "Kelompok belum dipetakan", summary.unmapped],
        ].map(([key, label, count]) => (
          <Card key={key}>
            <div className="text-xs text-mut">{label}</div>
            <div className={`mt-1 text-2xl font-semibold ${key === "unmapped" && count ? "text-amber-300" : ""}`} data-report-stat={key}>{count}</div>
          </Card>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-mut">
        Buka tiap interface untuk membaca jalur OLT → core feeder → splitter/ODC anak → ODP.
        Jumlah ODC/ODP dihitung unik dalam hasil, bukan penjumlahan baris jalur. Status port merupakan catatan manual, bukan hasil monitoring.
        Pencarian menyeleksi interface beserta seluruh jalurnya. CSV dan PDF memuat semua rincian dalam hasil filter, termasuk panel yang belum dibuka.
      </p>

      {items.length === 0 && <Card><Empty text="Tidak ada hasil sesuai filter. Ubah OLT/interface atau bersihkan pencarian. Port perlu dicatat di Manajemen OLT; sumber jalur dicatat di Mapping Core." /></Card>}
      {items.map((item) => (
        <details className="card group overflow-hidden" key={item.key} open={items.length === 1 ? true : undefined} data-report-group={item.key}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-acc" aria-label={`Rincian ${item.olt?.name || item.port?.olt_name || "OLT"} / ${item.unmapped ? `belum dipetakan ${item.groups[0].odc.name}` : interfaceLabel(item.port)}`}>
            <ChevronDown size={17} className="shrink-0 text-mut transition-transform group-open:rotate-180" />
            <div className="min-w-0 flex-1 basis-60">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-words font-semibold">{item.olt?.name || item.port?.olt_name || "OLT belum diketahui"}</span>
                {item.unmapped ? <Badge cls="bg-amber-500/15 text-amber-300">Belum dipetakan</Badge> : <InterfaceBadge port={item.port} />}
                {!item.unmapped && <Badge cls={PORT_STATUS[item.port.status]?.cls || "bg-slate-500/15 text-slate-300"}>{item.status} (catatan)</Badge>}
              </div>
              <div className="mt-1 break-words text-xs text-mut">
                {item.unmapped ? `${item.groups[0].odc.name} · ${item.reason}`
                  : item.groups.length ? item.groups.map((g) => `${g.odc.name} · core ${g.core ?? "belum diisi"}`).join(" / ")
                    : item.issues.length ? "Mapping sumber perlu diperiksa" : "Belum ada mapping ke core feeder"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-mut">
              <span>{item.odcIds.size} ODC</span><span>·</span><span>{item.odpIds.size} ODP unik</span>
            </div>
          </summary>
          <div className="border-t border-line p-4">
            {item.unmapped ? (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <p>{item.reason}. OLT pada judul hanya induk administratif ODC, bukan konfirmasi asal interface. Jalur ini tidak dimasukkan ke interface tertentu.</p>
              </div>
            ) : (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="break-all font-mono text-mut">{item.port.interface_cli || interfaceLabel(item.port)}</span>
                <Link className="btn" to={interfaceLink(item.port)}><Route size={14} /> Lihat di Alur Core</Link>
              </div>
            )}
            {item.issues.length > 0 && <p className="mb-3 text-xs text-amber-300">{item.issues.join(". ")}. Tujuan yang belum terkonfirmasi tidak dihitung sebagai tujuan interface ini.</p>}
            {item.groups.some((g) => g.mapping?.notes) && (
              <div className="mb-3 space-y-1 text-xs text-mut">
                {item.groups.filter((g) => g.mapping?.notes).map((g) => <p key={g.id} className="whitespace-pre-wrap break-words"><strong>{g.odc.name} / core {g.core}:</strong> {g.mapping.notes}</p>)}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <caption className="pb-2 text-left text-xs text-mut">{item.rows.length} baris rincian · tujuan ODP dan sambungan yang belum lengkap ditampilkan terpisah</caption>
                <thead className="border-b border-line"><tr>
                  <th className="th">ODC / core feeder</th><th className="th">Jalur lengkap</th>
                  <th className="th">ODP / ujung jalur</th><th className="th">Lokasi</th><th className="th">Kondisi / catatan</th>
                </tr></thead>
                <tbody>{item.rows.map((row) => (
                  <tr key={row.key} className="border-b border-line-soft last:border-0" data-report-route={row.odpId == null ? "pending" : row.odpId}>
                    <td className="td min-w-40 align-top">
                      <div className="mb-1 font-medium">{row.odc?.name || "—"}</div>
                      {row.odc && (row.core == null ? <span className="text-xs text-amber-300">Core belum diisi</span> : <CoreChip core={row.core} cableType={row.odc.cable_type} small />)}
                    </td>
                    <td className="td min-w-72 max-w-md whitespace-normal break-words align-top text-xs leading-relaxed text-mut">{row.path}</td>
                    <td className="td min-w-40 align-top">{row.target}</td>
                    <td className="td min-w-36 whitespace-pre-wrap break-words align-top text-xs text-mut">{row.location || "—"}</td>
                    <td className={`td min-w-44 align-top text-xs ${row.odpId == null ? "text-amber-300" : "text-mut"}`}>{row.condition}{row.connectionNotes && <p className="mt-1 whitespace-pre-wrap break-words text-mut">Catatan: {row.connectionNotes}</p>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </details>
      ))}
      {unconnectedCount > 0 && <p className="text-xs text-mut">{unconnectedCount} ODP pada OLT terpilih belum terjangkau oleh penelusuran sambungan. Tidak diasumsikan sebagai tujuan interface; periksa inventaris pada tab Power ODP dan lengkapi Mapping Core.</p>}
    </div>
  );
}
