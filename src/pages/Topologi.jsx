import { useCallback, useEffect, useState } from "react";
import { Boxes, Cable, ChevronRight, GitBranch, LayoutList, Network, Server, Share2 } from "lucide-react";
import { api } from "../lib/api.js";
import { Badge, Card, Empty, PageHeader } from "../components/ui.jsx";
import TopologiDiagram from "../components/TopologiDiagram.jsx";
import { getCableInfo } from "../lib/fiber.js";

/** Tampilan daftar bertingkat (bisa dibuka-tutup). */
function TreeView({ olts, odcs, odps, links, feederPorts, splitters }) {
  const [open, setOpen] = useState({});
  const toggle = (key) => setOpen((s) => ({ ...s, [key]: !s[key] }));

  if (!olts.length) return <Empty text="Belum ada data jaringan." />;

  return (
    <div className="space-y-4">
      {olts.map((olt) => {
        const myOdcs = odcs.filter((d) => d.olt_id === olt.id);
        return (
          <Card key={olt.id} className="p-0">
            <button
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-panel2"
              onClick={() => toggle(`olt-${olt.id}`)}
            >
              <ChevronRight size={15} className={`text-mut transition ${open[`olt-${olt.id}`] ? "rotate-90" : ""}`} />
              <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">
                <Server size={15} />
              </span>
              <div className="flex-1">
                <div className="font-semibold">{olt.name}</div>
                <div className="text-xs text-mut">
                  {olt.olt_type || "-"} · {olt.location || "tanpa lokasi"} · {olt.ip || "-"}
                </div>
              </div>
              <div className="text-xs text-mut">{myOdcs.length} ODC</div>
            </button>

            {open[`olt-${olt.id}`] && (
              <div className="ml-10 border-t border-line pr-4">
                {myOdcs.length === 0 && <div className="py-3 text-xs text-mut">Tidak ada ODC.</div>}
                {myOdcs.map((odc) => {
                  const myOdps = odps.filter((p) => p.odc_id === odc.id);
                  const mySplitters = splitters.filter((s) => s.odc_id === odc.id);
                  return (
                    <div key={odc.id} className="border-b border-line-soft py-1 last:border-0">
                      <button
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-panel2"
                        onClick={() => toggle(`odc-${odc.id}`)}
                      >
                        <ChevronRight size={14} className={`text-mut transition ${open[`odc-${odc.id}`] ? "rotate-90" : ""}`} />
                        <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
                          <Boxes size={13} />
                        </span>
                        <div className="flex-1">
                          <div className="text-sm font-medium">{odc.name}</div>
                          <div className="text-xs text-mut">
                            <Cable size={10} className="mr-1 inline" />
                            {getCableInfo(odc.cable_type)?.label ?? odc.cable_type} · {odc.location || "tanpa lokasi"}
                          </div>
                          <div className="text-[11px] text-mut-soft">
                            Port feeder: {(() => {
                              const fs = feederPorts.filter((f) => f.odc_id === odc.id);
                              return fs.length === 0
                                ? "belum diatur"
                                : fs.map((f) => `${f.card_label || `Card ${f.slot}`} p${f.port}`).join(", ");
                            })()}
                            {" · "}Core ⇄ ODP: {links.filter((l) => l.odc_id === odc.id).length} sambungan
                          </div>
                          {mySplitters.length > 0 && (
                            <div className="text-[11px] text-violet-300/90">
                              Splitter: {mySplitters.map((sp) => `${sp.name} (${sp.ratio})`).join(", ")}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-mut">{myOdps.length} ODP</div>
                      </button>

                      {open[`odc-${odc.id}`] && (
                        <div className="ml-10 pb-1">
                          {myOdps.length === 0 && <div className="py-1 text-xs text-mut">Tidak ada ODP.</div>}
                          {myOdps.map((odp) => {
                            const splInOdp = splitters.filter((sp) => sp.odp_id === odp.id);
                            return (
                              <div key={odp.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-panel2">
                                <span className="flex size-6 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">
                                  <Network size={12} />
                                </span>
                                <div className="flex-1">
                                  <div className="text-sm">{odp.name}</div>
                                  <div className="text-xs text-mut">
                                    {getCableInfo(odp.cable_type)?.label ?? odp.cable_type} · {odp.location || "tanpa lokasi"}
                                  </div>
                                  <div className="text-[11px] text-mut-soft">
                                    {links.filter((l) => l.odp_id === odp.id).length > 0 &&
                                      `Core dari ${odc.name}: ${links
                                        .filter((l) => l.odp_id === odp.id)
                                        .map((l) => `C${l.odc_core}→C${l.odp_core}`)
                                        .join(", ")}`}
                                  </div>
                                  {splInOdp.length > 0 && (
                                    <div className="text-[11px] text-violet-300/90">
                                      Splitter: {splInOdp.map((sp) => `${sp.name} (${sp.ratio})`).join(", ")}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export default function Topologi() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("diagram");

  const load = useCallback(async () => {
    const [olts, odcs, odps, links, feederPorts, splitters] = await Promise.all([
      api("/api/olts"),
      api("/api/odcs"),
      api("/api/odps"),
      api("/api/links"),
      api("/api/feeder-ports"),
      api("/api/splitters"),
    ]);
    setData({ olts, odcs, odps, links, feederPorts, splitters });
  }, []);

  useEffect(() => {
    load().catch(() => setData({ olts: [], odcs: [], odps: [], links: [], feederPorts: [], splitters: [] }));
  }, [load]);

  if (!data) return <div className="text-sm text-mut">Memuat…</div>;

  const totalOdp = data.odps.length;
  const totalSpl = data.splitters.length;

  return (
    <div>
      <PageHeader title="Topologi Jaringan" desc="Alur nyata jaringan: OLT → port feeder → ODC → splitter (bertingkat) → ODP.">
        <div className="flex gap-1 rounded-lg border border-line bg-panel2 p-1">
          <button
            className={`btn px-3 py-1.5 text-xs ${view === "diagram" ? "btn-primary" : "border-transparent bg-transparent"}`}
            onClick={() => setView("diagram")}
          >
            <Share2 size={13} /> Diagram
          </button>
          <button
            className={`btn px-3 py-1.5 text-xs ${view === "daftar" ? "btn-primary" : "border-transparent bg-transparent"}`}
            onClick={() => setView("daftar")}
          >
            <LayoutList size={13} /> Daftar
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
          <GitBranch size={12} className="mr-1" /> {totalSpl} Splitter
        </Badge>
        <Badge cls="bg-amber-500/15 text-amber-300">
          <Network size={12} className="mr-1" /> {totalOdp} ODP
        </Badge>
        <Badge cls="bg-slate-500/15 text-slate-300">{data.links.length} sambungan core ODC → ODP</Badge>
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
      ) : (
        <TreeView
          olts={data.olts}
          odcs={data.odcs}
          odps={data.odps}
          links={data.links}
          feederPorts={data.feederPorts}
          splitters={data.splitters}
        />
      )}
    </div>
  );
}
