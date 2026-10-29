import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Cpu, Wifi } from "lucide-react";
import { Badge, Card, Empty } from "./ui.jsx";
import { interfaceMode } from "../lib/interfaces.js";

function Total({ label, value, hint, tint = "text-ink" }) {
  return <div className="rounded-lg bg-panel2 px-3 py-3 text-center">
    <div className={`text-xl font-bold tabular-nums ${tint}`}>{value}</div>
    <div className="mt-0.5 text-[11px] text-mut">{label}</div>
    {hint && <div className="mt-0.5 text-[10px] text-mut-soft">{hint}</div>}
  </div>;
}

function OltDevice({ olt }) {
  const types = new Map();
  for (const card of olt.cards) {
    if (!card.is_builtin) types.set(card.card_type, (types.get(card.card_type) || 0) + 1);
  }
  const fixedPorts = interfaceMode(olt) !== "shelf_slot_port";
  return <details open data-olt-device={olt.id} className="group overflow-hidden rounded-xl border border-line bg-panel-soft">
    <summary className="flex cursor-pointer list-none items-start gap-3 p-3 [&::-webkit-details-marker]:hidden">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300"><Wifi size={16} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words text-sm font-semibold">{olt.name}</span>
          <Badge cls="bg-slate-500/15 text-mut">{olt.olt_type || "Model belum diisi"}</Badge>
        </div>
        <div className="mt-1 text-[11px] leading-relaxed text-mut">
          {olt.cardCount > 0 || !fixedPorts ? `${olt.cardCount} card terpasang` : "Port bawaan · tanpa card terpisah"}
          {` · ${olt.portsRecorded}/${olt.portCapacity} port tercatat`}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <span className="text-emerald-400"><b className="tabular-nums">{olt.portsActive}</b> aktif</span>
          <span className="text-cyan-300"><b className="tabular-nums">{olt.portsUsed}</b> terpakai</span>
          {olt.portsFeederPending > 0 && <span className="text-amber-400">{olt.portsFeederPending} feeder belum dipetakan</span>}
        </div>
      </div>
      <ChevronDown size={16} aria-hidden="true" className="mt-2 shrink-0 text-mut transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-line">
      {types.size > 0 && <div className="flex flex-wrap gap-1.5 px-3 pt-3" aria-label={`Card terpasang ${olt.name}`}>
        {[...types].map(([type, count]) => <Badge key={type} cls="bg-violet-500/10 text-violet-300"><Cpu size={11} className="mr-1" />{count}× {type}</Badge>)}
      </div>}
      {olt.cards.length ? <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[29rem] text-xs" aria-label={`Rincian card dan port ${olt.name}`}>
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className="th">Card / posisi</th>
              <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-mut" title="Jumlah port fisik sesuai pencatatan card/OLT">Kapasitas</th>
              <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-mut" title="Interface yang sudah dicatat di Manajemen OLT">Tercatat</th>
              <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-mut" title="Port dengan status manual Aktif">Aktif</th>
              <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-mut" title="Port yang sudah dipetakan ke core feeder">Terpakai</th>
            </tr>
          </thead>
          <tbody>{olt.cards.map((card) => <tr key={card.id} data-olt-card={card.id} className="border-b border-line-soft last:border-0">
            <th scope="row" className="td text-left font-normal">
              <span className="font-semibold">{card.is_builtin ? "Port bawaan OLT" : card.card_type}</span>
              {!card.is_builtin && <div className="mt-0.5 whitespace-nowrap text-[10px] text-mut">Shelf {card.shelf} · Slot {card.slot}</div>}
              {card.label && !card.is_builtin && <div className="mt-0.5 max-w-40 break-words text-[10px] text-mut">{card.label}</div>}
            </th>
            <td className="td text-right tabular-nums">{card.port_count}</td>
            <td className="td text-right tabular-nums">{card.portsRecorded}</td>
            <td className="td text-right font-semibold tabular-nums text-emerald-400">{card.portsActive}</td>
            <td className="td text-right font-semibold tabular-nums text-cyan-300">
              {card.portsUsed}
              {card.portsFeederPending > 0 && <div className="mt-0.5 max-w-28 text-[10px] font-normal text-amber-400">{card.portsFeederPending} feeder belum dipetakan</div>}
            </td>
          </tr>)}</tbody>
          <tfoot className="border-t border-line bg-panel2 font-semibold">
            <tr><th scope="row" className="td text-left">Total {olt.name}</th><td className="td text-right tabular-nums">{olt.portCapacity}</td><td className="td text-right tabular-nums">{olt.portsRecorded}</td><td className="td text-right tabular-nums text-emerald-400">{olt.portsActive}</td><td className="td text-right tabular-nums text-cyan-300">{olt.portsUsed}</td></tr>
          </tfoot>
        </table>
      </div> : <p className="px-3 pt-3 text-xs text-mut">{fixedPorts ? "Belum ada port bawaan yang tercatat. Periksa jumlah port di Rincian OLT." : "Belum ada card yang tercatat untuk OLT ini."}</p>}
      <div className="px-3 pb-3 pt-1">
        <Link className="inline-flex items-center gap-1 text-xs font-medium text-acc hover:underline" to={`/olt?olt=${olt.id}`}>Rincian OLT & interface <ChevronRight size={13} /></Link>
      </div>
    </div>
  </details>;
}

export default function DashboardOltDevices({ data }) {
  const available = Array.isArray(data.oltDevices);
  return <Card className="min-w-0 lg:col-span-2">
    <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Wifi size={16} className="text-acc" /> Perangkat OLT</h2>
    <p className="mb-4 text-xs text-mut">Rincian card dan pemakaian port per OLT.</p>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Total label="Card terpasang" value={data.cards} />
      <Total label="Port tercatat" value={data.ports} hint={data.portCapacity != null ? `dari ${data.portCapacity} kapasitas` : null} />
      <Total label="Port Aktif" value={data.portsActive} tint="text-emerald-400" />
      <Total label="Port terpakai" value={data.portsUsed ?? "—"} tint="text-cyan-300" />
    </div>
    <div className="my-4 rounded-lg border border-line bg-panel2 px-3 py-2 text-[11px] leading-relaxed text-mut">
      <b className="text-emerald-400">Aktif</b> = status port yang dicatat manual. <b className="text-cyan-300">Terpakai</b> = port sudah dipetakan ke core feeder, dihitung satu kali per port. Keduanya bisa tumpang tindih, bukan dijumlahkan.
      <p className="mt-1">Feeder tanpa mapping yang valid ditandai belum dipetakan; periksa di Mapping Core. Kapasitas mengikuti card/OLT yang dicatat; port yang belum dicatat tidak dianggap idle. Ini bukan pemantauan langsung dari OLT.</p>
    </div>
    {!available ? <p role="alert" className="rounded-lg border border-amber-500/30 p-3 text-xs text-amber-400">Rincian perangkat belum tersedia dari API. Pastikan backend sudah diperbarui, lalu muat ulang dashboard.</p>
      : data.oltDevices.length ? <div className="space-y-3">{data.oltDevices.map((olt) => <OltDevice key={olt.id} olt={olt} />)}</div>
        : <Empty text="Belum ada OLT yang tercatat. Tambahkan perangkat di Manajemen OLT untuk melihat rincian card dan port." />}
  </Card>;
}
