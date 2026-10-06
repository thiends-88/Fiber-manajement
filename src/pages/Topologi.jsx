import { useEffect, useState } from "react";
import { Boxes, Cable, ChevronRight, Network, Server } from "lucide-react";
import { api } from "../lib/api.js";
import { Card, Empty, PageHeader } from "../components/ui.jsx";
import { getCableInfo } from "../lib/fiber.js";

export default function Topologi() {
  const [tree, setTree] = useState(null);
  const [links, setLinks] = useState([]);
  const [feederPorts, setFeederPorts] = useState([]);

  useEffect(() => {
    Promise.all([api("/api/olts"), api("/api/odcs"), api("/api/odps"), api("/api/links"), api("/api/feeder-ports")])
      .then(([olts, odcs, odps, lk, f]) => {
        setLinks(lk);
        setFeederPorts(f);
        setTree(
          olts.map((o) => ({
            ...o,
            odcs: odcs
              .filter((d) => d.olt_id === o.id)
              .map((d) => ({ ...d, odps: odps.filter((p) => p.odc_id === d.id) })),
          })),
        );
      })
      .catch(() => setTree([]));
  }, []);

  const toggle = (key) => setOpen((s) => ({ ...s, [key]: !s[key] }));

  if (!tree) return <div className="text-sm text-mut">Memuat…</div>;

  return (
    <div>
      <PageHeader title="Topologi Jaringan" desc="Struktur OLT → ODC → ODP lengkap dengan port feeder, power, dan core tersambung." />
      {tree.length === 0 && <Empty text="Belum ada data jaringan." />}
      <div className="space-y-4">
        {tree.map((olt) => (
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
                <div className="text-xs text-mut">{olt.olt_type || "-"} · {olt.location || "tanpa lokasi"} · {olt.ip || "-"}</div>
              </div>
              <div className="text-xs text-mut">{olt.odcs.length} ODC</div>
            </button>

            {open[`olt-${olt.id}`] && (
              <div className="ml-10 border-t border-line pr-4">
                {olt.odcs.length === 0 && <div className="py-3 text-xs text-mut">Tidak ada ODC.</div>}
                {olt.odcs.map((odc) => (
                  <div key={odc.id} className="border-b border-line/40 py-1 last:border-0">
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
                        <div className="text-[11px] text-mut/80">
                          Port feeder: {(() => {
                            const fs = feederPorts.filter((f) => f.odc_id === odc.id);
                            return fs.length === 0
                              ? "belum diatur"
                              : fs.map((f) => `${f.card_label || `Card ${f.slot}`} p${f.port}`).join(", ");
                          })()}
                          {" · "}Core ⇄ ODP: {links.filter((l) => l.odc_id === odc.id).length} sambungan
                        </div>
                      </div>
                      <div className="text-xs text-mut">{odc.odps.length} ODP</div>
                    </button>

                    {open[`odc-${odc.id}`] && (
                      <div className="ml-10 pb-1">
                        {odc.odps.length === 0 && <div className="py-1 text-xs text-mut">Tidak ada ODP.</div>}
                        {odc.odps.map((odp) => (
                          <div key={odp.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-panel2">
                            <span className="flex size-6 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">
                              <Network size={12} />
                            </span>
                            <div className="flex-1">
                              <div className="text-sm">{odp.name}</div>
                              <div className="text-xs text-mut">
                                {getCableInfo(odp.cable_type)?.label ?? odp.cable_type} · {odp.location || "tanpa lokasi"}
                              </div>
                              <div className="text-[11px] text-mut/80">
                                {links.filter((l) => l.odp_id === odp.id).length > 0 &&
                                  `Core dari ${odc.name}: ${links.filter((l) => l.odp_id === odp.id).map((l) => `C${l.odc_core}→C${l.odp_core}`).join(", ")}`}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
