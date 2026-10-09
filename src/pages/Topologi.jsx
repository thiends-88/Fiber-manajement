import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Cable, GitBranch, Link2, Network, Server, Share2, Workflow } from "lucide-react";
import { api } from "../lib/api.js";
import { Badge, Card, Empty, PageHeader } from "../components/ui.jsx";
import TopologiDiagram from "../components/TopologiDiagram.jsx";
import { Arrow, CoreChip, PohonJalur } from "../components/JalurCore.jsx";
import { STATUS, getCableInfo } from "../lib/fiber.js";
import { buildCoreRoutes } from "../lib/jalur-core.js";

/**
 * Halaman utama aplikasi: ALUR CORE.
 *
 * Menjawab satu pertanyaan teknisi — "core ini jalurnya ke mana?" — dengan
 * gambar yang urut seperti kenyataan di lapangan:
 *
 *   port GPON OLT → core kabel ODC (berwarna) → splitter 1:4 di ODC
 *   → cascade splitter 1:8 → core ke tiap ODP → splitter 1:8 di dalam ODP
 *
 * Tidak ada hitung-hitungan redaman/daya di sini: hanya alur dan nama perangkat.
 */

const KOSONG = { olts: [], odcs: [], odps: [], splitters: [], links: [], feederPorts: [], cores: [] };

export default function Topologi() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("alur");

  const load = useCallback(async () => {
    const [olts, odcs, odps, links, feederPorts, splitters, cores] = await Promise.all([
      api("/api/olts"),
      api("/api/odcs"),
      api("/api/odps"),
      api("/api/links"),
      api("/api/feeder-ports"),
      api("/api/splitters"),
      api("/api/cores"),
    ]);
    setData({ olts, odcs, odps, links, feederPorts, splitters, cores });
  }, []);

  useEffect(() => {
    load().catch(() => setData(KOSONG));
  }, [load]);

  // Pohon jalur per ODC, dihitung sekali untuk semua ODC
  const petaPerOdc = useMemo(() => {
    if (!data) return new Map();
    const hasil = new Map();
    for (const odc of data.odcs) {
      hasil.set(
        odc.id,
        buildCoreRoutes({
          odcs: data.odcs,
          odps: data.odps,
          splitters: data.splitters,
          links: data.links,
          cores: data.cores,
          odcId: odc.id,
        }),
      );
    }
    return hasil;
  }, [data]);

  if (!data) return <div className="text-sm text-mut">Memuat…</div>;

  const coreTerpetakan = data.links.length + data.splitters.filter((s) => s.input_core != null && s.input_core !== "").length;

  return (
    <div>
      <PageHeader
        title="Alur Core OLT → ODC → ODP"
        desc="Alur core kabel dari port OLT, lewat splitter di ODC, sampai ke tiap ODP."
      >
        <div className="flex gap-1 rounded-lg border border-line bg-panel2 p-1">
          <button
            className={`btn px-3 py-1.5 text-xs ${view === "alur" ? "btn-primary" : "border-transparent bg-transparent"}`}
            onClick={() => setView("alur")}
          >
            <Workflow size={13} /> Alur Core
          </button>
          <button
            className={`btn px-3 py-1.5 text-xs ${view === "diagram" ? "btn-primary" : "border-transparent bg-transparent"}`}
            onClick={() => setView("diagram")}
          >
            <Share2 size={13} /> Diagram
          </button>
        </div>
      </PageHeader>

      {/* ringkasan cepat */}
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Badge cls="bg-cyan-500/15 text-cyan-300">
          <Server size={12} className="mr-1" /> {data.olts.length} OLT
        </Badge>
        <Badge cls="bg-emerald-500/15 text-emerald-300">
          <Boxes size={12} className="mr-1" /> {data.odcs.length} ODC
        </Badge>
        <Badge cls="bg-violet-500/15 text-violet-300">
          <GitBranch size={12} className="mr-1" /> {data.splitters.length} Splitter
        </Badge>
        <Badge cls="bg-amber-500/15 text-amber-300">
          <Network size={12} className="mr-1" /> {data.odps.length} ODP
        </Badge>
        <Badge cls="bg-slate-500/15 text-slate-300">{coreTerpetakan} core terpetakan</Badge>
      </div>

      {view === "diagram" ? (
        <TopologiDiagram
          olts={data.olts}
          odcs={data.odcs}
          odps={data.odps}
          splitters={data.splitters}
          links={data.links}
          feederPorts={data.feederPorts}
        />
      ) : data.odcs.length === 0 ? (
        <Empty text="Belum ada ODC. Tambahkan OLT, ODC, dan ODP lebih dulu, lalu arahkan output splitter-nya." />
      ) : (
        <div className="space-y-5">
          {data.odcs.map((odc) => {
            const olt = data.olts.find((o) => o.id === odc.olt_id);
            const peta = petaPerOdc.get(odc.id) ?? { trees: [], directLinks: [] };
            const feeder = data.feederPorts.filter((f) => f.odc_id === odc.id);
            const adaJalur = peta.trees.length > 0 || peta.directLinks.length > 0;
            return (
              <Card key={odc.id}>
                {/* kepala: dari OLT mana core ini datang */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">
                    <Server size={15} />
                  </span>
                  <span className="text-sm font-semibold">{olt?.name ?? "OLT ?"}</span>
                  <Arrow />
                  <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
                    <Boxes size={15} />
                  </span>
                  <span className="text-sm font-semibold">{odc.name}</span>
                  <span className="text-xs text-mut">
                    <Cable size={11} className="mr-1 inline" />
                    {getCableInfo(odc.cable_type)?.label ?? odc.cable_type}
                  </span>
                  <span className="ml-auto text-[11px] text-mut">
                    Port feeder:{" "}
                    {feeder.length === 0
                      ? "belum diatur"
                      : feeder.map((f) => `${f.card_label || `Card ${f.slot}`} p${f.port}`).join(", ")}
                  </span>
                </div>

                {!adaJalur && (
                  <Empty text="Belum ada jalur core di ODC ini. Arahkan output splitter, atau pakai “Tambah Sambungan” di halaman Mapping Core." />
                )}

                {/* satu kotak per core yang masuk ke splitter */}
                {peta.trees.length > 0 && (
                  <div className="space-y-3">
                    {peta.trees.map((t) => {
                      const status = t.feeder ? STATUS[t.feeder.status] : null;
                      return (
                        <div key={`pohon-${t.core}`} className="rounded-xl border border-line bg-panel-soft p-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <CoreChip core={t.core} cableType={odc.cable_type} small />
                            {status && <Badge cls={status.cls}>{status.label}</Badge>}
                            <span className="text-[11px] text-mut">{odc.name}</span>
                          </div>
                          <PohonJalur node={t.root} feed={{ core: t.core, cableType: odc.cable_type }} />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* core yang disambung langsung ke ODP tanpa splitter */}
                {peta.directLinks.length > 0 && (
                  <div className={peta.trees.length > 0 ? "mt-4" : ""}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Link2 size={14} className="text-emerald-400" />
                      <h3 className="text-sm font-semibold">Sambungan Kabel Langsung</h3>
                      <span className="text-xs text-mut">— 1 core ODC → 1 ODP, tanpa lewat splitter</span>
                    </div>
                    <div className="space-y-1.5">
                      {peta.directLinks.map((l) => (
                        <div
                          key={l.linkId}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs"
                        >
                          <CoreChip core={l.odcCore} cableType={odc.cable_type} small />
                          <Arrow />
                          <span className="font-semibold text-emerald-300">{l.odpName}</span>
                          <span className="text-mut">core {l.odpCore}</span>
                          {l.notes && <span className="text-mut">· {l.notes}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
