import { useCallback, useEffect, useRef, useState } from "react";
import { Boxes, Cable, GitBranch, Network, RefreshCw, Server, Workflow } from "lucide-react";
import { api } from "../lib/api.js";
import { Card, PageHeader } from "../components/ui.jsx";
import DashboardOltDevices from "../components/DashboardOltDevices.jsx";
import { STATUS } from "../lib/fiber.js";

function StatCard({ icon: Icon, label, value, hint, tint }) {
  return (
    <Card className="flex items-center gap-4">
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon size={20} />
      </span>
      <div>
        <div className="text-2xl font-bold leading-tight">{value}</div>
        <div className="text-xs text-mut">{label}</div>
        {hint && <div className="text-[11px] text-mut-soft">{hint}</div>}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true); setErr("");
    try {
      const next = await api("/api/dashboard");
      if (version === requestVersion.current) setD(next);
    } catch (error) {
      if (version === requestVersion.current) setErr(error.message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => { load(); return () => { requestVersion.current++; }; }, [load]);

  const statusRows = d ? [
    ["used", d.coresUsed],
    ["reserved", d.coresReserved],
    ["idle", d.coresIdle],
    ["damaged", d.coresDamaged],
  ] : [];

  return (
    <div>
      <PageHeader title="Dashboard" desc="Ringkasan jaringan OLT → ODC → ODP.">
        <button type="button" className="btn" disabled={loading} onClick={load} aria-label="Muat ulang dashboard">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat ulang
        </button>
      </PageHeader>
      {err && <Card className="mb-4 border-red-500/30 bg-red-500/5">
        <p role="alert" className="text-sm text-red-400">{err}</p>
        {d ? <p className="mt-1 text-xs text-mut">Pembaruan gagal. Ringkasan terakhir masih ditampilkan; muat ulang untuk mencoba lagi.</p>
          : <button type="button" className="btn mt-3" onClick={load}>Coba lagi</button>}
      </Card>}
      {!d && loading && <div role="status" className="animate-pulse p-8 text-sm text-mut">Memuat ringkasan jaringan…</div>}
      {d && <>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
          <StatCard icon={Server} label="OLT" value={d.olts} tint="bg-cyan-500/15 text-cyan-300" />
          <StatCard icon={Boxes} label="ODC" value={d.odcs} tint="bg-emerald-500/15 text-emerald-300" />
          <StatCard icon={Network} label="ODP" value={d.odps} tint="bg-amber-500/15 text-amber-300" />
          <StatCard icon={Cable} label="Core Terdaftar" value={d.cores} tint="bg-fuchsia-500/15 text-fuchsia-300" />
          <StatCard
            icon={Workflow}
            label="Sambungan Core ODC→ODP"
            value={d.links ?? 0}
            hint="lihat menu Mapping Core"
            tint="bg-violet-500/15 text-violet-300"
          />
          <StatCard
            icon={GitBranch}
            label="Splitter"
            value={d.splitters ?? 0}
            hint="bertahap / cascade"
            tint="bg-sky-500/15 text-sky-300"
          />
        </div>

        <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
          <DashboardOltDevices data={d} />
          <Card className="min-w-0">
            <h2 className="mb-3 text-sm font-semibold">Status Core</h2>
            <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-panel2">
              {statusRows.map(([k, n]) =>
                n > 0 ? (
                  <div
                    key={k}
                    style={{
                      width: `${(n / Math.max(d.cores, 1)) * 100}%`,
                      background:
                        k === "used" ? "#34d399" : k === "reserved" ? "#fbbf24" : k === "damaged" ? "#f87171" : "#64748b",
                    }}
                  />
                ) : null,
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {statusRows.map(([k, n]) => (
                <div key={k} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2">
                  <span className={`badge ${STATUS[k].cls}`}>{STATUS[k].label}</span>
                  <span className="text-sm font-semibold">{n}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </>}
    </div>
  );
}
