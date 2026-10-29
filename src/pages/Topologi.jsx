import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Boxes, Network, RefreshCw, Server, Share2, Workflow } from "lucide-react";
import { Badge, Card, Empty, PageHeader, SearchBox } from "../components/ui.jsx";
import TopologiDiagram from "../components/TopologiDiagram.jsx";
import InterfaceBadge from "../components/InterfaceBadge.jsx";
import { Arrow, CoreChip, PohonJalur } from "../components/JalurCore.jsx";
import { getCableInfo, PORT_STATUS } from "../lib/fiber.js";
import { interfaceLabel, sortInterfaces } from "../lib/interfaces.js";
import { buildInterfaceRoutes, filterInterfaceGroups } from "../lib/interface-routes.js";
import { buildInterfaceTopology } from "../lib/interface-topology.js";
import { loadNetworkData } from "../lib/network-data.js";

export default function Topologi() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("alur");
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const oltId = params.get("olt") || "";
  const portId = params.get("interface") || "";
  const load = useCallback(async () => { setError(""); setData(await loadNetworkData()); }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const routes = useMemo(() => buildInterfaceRoutes(data || {}), [data]);
  const groups = useMemo(() => filterInterfaceGroups(routes.groups, { oltId, portId, query }), [routes, oltId, portId, query]);
  const relevantOdcs = (data?.odcs || []).filter((d) => !oltId || Number(d.olt_id) === Number(oltId));
  const showUnconnected = !portId;
  const unconnectedOdcs = routes.unconnectedOdcs.filter((d) => showUnconnected && relevantOdcs.some((o) => o.id === d.id) && (!query.trim() || `${d.name} ${d.location || ""}`.toLowerCase().includes(query.trim().toLowerCase())));
  const unconnectedOdps = routes.unconnectedOdps.filter((p) => showUnconnected && relevantOdcs.some((o) => o.id === p.odc_id) && (!query.trim() || `${p.name} ${p.location || ""}`.toLowerCase().includes(query.trim().toLowerCase())));
  const diagram = useMemo(() => buildInterfaceTopology({ groups, unconnectedOdcs, unconnectedOdps, odcs: data?.odcs, cores: data?.cores }), [groups, data, oltId, portId, query]);

  if (error) return <div className="card p-4" role="alert"><div className="font-semibold">Data Alur Core tidak dapat dimuat</div><p className="my-2 text-sm text-mut">{error}</p><button className="btn" onClick={() => load().catch((e) => setError(e.message))}>Coba lagi</button></div>;
  if (!data) return <div className="text-sm text-mut">Memuat alur interface…</div>;

  const options = sortInterfaces(data.ports.filter((p) => !oltId || Number(p.olt_id) === Number(oltId)));
  const selectedPort = options.find((p) => String(p.id) === portId);
  const visibleOdpIds = new Set(groups.flatMap((g) => [...g.odpIds]));
  const unknown = filterInterfaceGroups(routes.groups, { oltId }).filter((g) => !g.port).length;
  function chooseOlt(id) { setParams(id ? { olt: id } : {}); }
  function choosePort(id) { setParams({ ...(oltId ? { olt: oltId } : {}), ...(id ? { interface: id } : {}) }); }

  return (
    <div>
      <PageHeader title="Alur Core OLT → ODC → ODP" desc="Pilih interface OLT untuk melihat jalur core, splitter, dan seluruh ODP yang dilayaninya.">
        <div className="flex flex-wrap gap-2">
          <button className="btn px-2" title="Muat ulang jalur" onClick={() => load().catch((e) => setError(e.message))}><RefreshCw size={14} /></button>
          <div className="flex gap-1 rounded-lg border border-line bg-panel2 p-1">
            <button className={`btn px-3 py-1.5 text-xs ${view === "alur" ? "btn-primary" : "border-transparent bg-transparent"}`} onClick={() => setView("alur")}><Workflow size={13} /> Alur Core</button>
            <button className={`btn px-3 py-1.5 text-xs ${view === "diagram" ? "btn-primary" : "border-transparent bg-transparent"}`} onClick={() => setView("diagram")}><Share2 size={13} /> Diagram</button>
          </div>
        </div>
      </PageHeader>

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-xs font-medium">OLT sumber
            <select aria-label="OLT sumber" className="input mt-1" value={oltId} onChange={(e) => chooseOlt(e.target.value)}>
              <option value="">Semua OLT</option>
              {oltId && !data.olts.some((o) => String(o.id) === oltId) && <option value={oltId} disabled>OLT tidak ditemukan</option>}
              {data.olts.map((o) => <option key={o.id} value={o.id}>{o.name} — {o.olt_type || "OLT"}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium">Interface sumber
            <select aria-label="Interface sumber" className="input mt-1" value={portId} onChange={(e) => choosePort(e.target.value)}>
              <option value="">Semua interface</option>
              <option value="unmapped">Belum dipetakan ({unknown} jalur)</option>
              {portId && portId !== "unmapped" && !options.some((p) => String(p.id) === portId) && <option value={portId} disabled>Interface tidak ditemukan pada OLT ini</option>}
              {options.map((p) => <option key={p.id} value={p.id}>{!oltId ? `${p.olt_name} / ` : ""}{interfaceLabel(p)}</option>)}
            </select>
          </label>
          <div className="self-end"><SearchBox value={query} onChange={setQuery} placeholder="Cari ODP, ODC, interface, core, warna…" /></div>
        </div>
        <details className="mt-3 text-xs text-mut">
          <summary className="cursor-pointer font-medium text-ink">Cara mencatat jalur di lapangan</summary>
          <ol className="mt-2 list-inside list-decimal space-y-1.5">
            <li><Link className="text-acc underline" to="/olt">Manajemen OLT</Link>: catat shelf, slot/card, dan port sesuai perangkat. ZTE: 1/1/1 = shelf 1, slot 1, port 1.</li>
            <li><Link className="text-acc underline" to="/odc">Manajemen ODC</Link>: pilih interface feeder yang masuk ke kabinet.</li>
            <li><Link className="text-acc underline" to="/mapping">Mapping Core</Link>: tentukan interface → core feeder, lalu catat sambungan splitter atau kabel langsung.</li>
            <li>Kembali ke halaman ini dan pilih interface. Pencarian mempertahankan jalur lengkap supaya asal dan tujuan tetap terbaca.</li>
          </ol>
          <p className="mt-2">Status port adalah catatan manual, bukan pembacaan langsung dari OLT. Data lama yang belum dipetakan tidak ditentukan otomatis.</p>
        </details>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Badge cls="bg-cyan-500/15 text-cyan-300"><Server size={12} className="mr-1" />{new Set(groups.map((g) => g.olt?.id)).size} OLT</Badge>
        <Badge cls="bg-emerald-500/15 text-emerald-300"><Boxes size={12} className="mr-1" />{groups.length} jalur feeder</Badge>
        <Badge cls="bg-amber-500/15 text-amber-300"><Network size={12} className="mr-1" />{visibleOdpIds.size} ODP pada jalur ini</Badge>
        {selectedPort && <Badge cls={PORT_STATUS[selectedPort.status]?.cls}>Status tercatat: {PORT_STATUS[selectedPort.status]?.label}</Badge>}
        {(oltId || portId || query) && <button className="btn py-1 text-xs" onClick={() => { setParams({}); setQuery(""); }}>Reset filter</button>}
      </div>
      {unknown > 0 && !portId && <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-mut"><span className="font-semibold text-amber-300">{unknown} jalur belum memiliki interface asal.</span> Daftar port feeder pada ODC saja belum cukup untuk menentukan asal setiap core. <Link className="text-acc underline" to="/mapping">Lengkapi di Mapping Core</Link>.</div>}

      {view === "diagram" ? <TopologiDiagram graph={diagram} query={query} /> : <div className="space-y-4">
        {groups.map((g) => <Card key={g.id}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Server size={16} className="text-cyan-300" /><span className="font-semibold">{g.olt?.name || "OLT ?"}</span><Arrow /><InterfaceBadge port={g.port} /><Arrow />
            <span className="font-semibold">{g.odc.name}</span>
            {g.core != null ? <CoreChip core={g.core} cableType={g.odc.cable_type} small /> : <Badge cls="bg-amber-500/15 text-amber-300">Core masuk belum diisi</Badge>}
            <span className="ml-auto text-xs text-mut">{g.odpIds.size} ODP</span>
          </div>
          <div className="mt-1 text-[11px] text-mut">{getCableInfo(g.odc.cable_type)?.label} · {g.odc.location || "Lokasi belum diisi"}{g.port?.interface_cli ? ` · ${g.port.interface_cli}` : ""}</div>
          {g.mapping?.notes && <p className="mt-1 text-xs text-mut">Catatan feeder: {g.mapping.notes}</p>}
          {g.inputConflict && <p className="mt-2 text-xs text-amber-300">Core ini memiliki beberapa input langsung. Sumber tidak dianggap terkonfirmasi sampai sambungan ganda diperiksa. Satu core feeder tidak boleh sekaligus menjadi kabel langsung dan input splitter.</p>}
          {!g.port && <Link to={g.core == null ? `/odc?odc=${g.odc.id}` : `/mapping?odc=${g.odc.id}`} className="mt-2 inline-block text-xs text-acc underline">{g.core == null ? "Isi core input splitter di Manajemen ODC, lalu petakan interface" : "Tentukan interface asal untuk core ini"}</Link>}
          {g.trees.length > 0 && <div className="mt-3 space-y-3">{g.trees.map((t, i) => <PohonJalur key={i} node={t.root} feed={g.core == null ? null : { core: g.core, cableType: g.odc.cable_type }} />)}</div>}
          {g.directLinks.length > 0 && <div className="mt-3 rounded-lg border border-line bg-panel2 p-3">
            <h3 className="mb-2 text-xs font-semibold">Sambungan Kabel Langsung <span className="font-normal text-mut">— tanpa splitter di ODC</span></h3>
            <div className="space-y-2">{g.directLinks.map((l) => <div key={l.id} className="flex flex-wrap items-center gap-2 text-xs"><CoreChip core={l.odcCore} cableType={g.odc.cable_type} small /><Arrow /><span className="font-semibold text-emerald-300">{l.odpName}</span><CoreChip core={l.odpCore} cableType={l.node.cableType} small />{l.notes && <span className="text-mut">{l.notes}</span>}</div>)}</div>
          </div>}
          {!g.trees.length && !g.directLinks.length && <p className="mt-3 text-xs text-mut">Interface sudah dipetakan ke core ini; sambungan menuju splitter/ODP belum dicatat.</p>}
        </Card>)}
        {!groups.length && <Empty text={portId ? "Belum ada jalur untuk interface/filter ini. Pilih ODC di Mapping Core, lalu catat interface → core feeder." : "Belum ada jalur yang cocok. Tambahkan perangkat dan catat sambungannya, atau ubah pencarian."} />}
        {(unconnectedOdps.length > 0 || unconnectedOdcs.length > 0) && <Card>
          <h2 className="mb-2 text-sm font-semibold">Perangkat belum memiliki jalur</h2>
          <p className="mb-2 text-xs text-mut">Perangkat ini belum dapat dihubungkan ke interface tertentu berdasarkan sambungan yang tercatat.</p>
          <div className="flex flex-wrap gap-2">{unconnectedOdcs.map((d) => <Badge key={`d-${d.id}`} cls="bg-slate-500/15 text-slate-300">{d.name}</Badge>)}{unconnectedOdps.map((p) => <Badge key={`p-${p.id}`} cls="bg-amber-500/15 text-amber-300">{p.name}</Badge>)}</div>
        </Card>}
      </div>}
    </div>
  );
}
