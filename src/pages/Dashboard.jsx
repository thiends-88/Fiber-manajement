import { useEffect, useState } from "react";
import { Boxes, Cable, Network, Server, Wifi } from "lucide-react";
import { api } from "../lib/api.js";
import { Card, PageHeader } from "../components/ui.jsx";
import { STATUS } from "../lib/fiber.js";

function StatCard({ icon: Icon, label, value, hint, tint }) {
  return (
    <Card className="flex items-center gap-4">
      <span className={`flex size-11 items-center justify-center rounded-lg ${tint}`}>
        <Icon size={20} />
      </span>
      <div>
        <div className="text-2xl font-bold leading-tight">{value}</div>
        <div className="text-xs text-mut">{label}</div>
        {hint && <div className="text-[11px] text-mut/70">{hint}</div>}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/dashboard").then(setD).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="card p-6 text-red-300">{err}</div>;
  if (!d) return <div className="text-sm text-mut">Memuat…</div>;

  const statusRows = [
    ["used", d.coresUsed],
    ["reserved", d.coresReserved],
    ["idle", d.coresIdle],
    ["damaged", d.coresDamaged],
  ];

  return (
    <div>
      <PageHeader title="Dashboard" desc="Ringkasan jaringan OLT → ODC → ODP." />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard icon={Server} label="OLT" value={d.olts} tint="bg-cyan-500/15 text-cyan-300" />
        <StatCard icon={Boxes} label="ODC" value={d.odcs} tint="bg-emerald-500/15 text-emerald-300" />
        <StatCard icon={Network} label="ODP" value={d.odps} tint="bg-amber-500/15 text-amber-300" />
        <StatCard icon={Cable} label="Core Terdaftar" value={d.cores} tint="bg-fuchsia-500/15 text-fuchsia-300" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Wifi size={16} className="text-acc" /> Perangkat OLT
          </h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-panel2 p-3">
              <div className="text-xl font-bold">{d.cards}</div>
              <div className="text-xs text-mut">Card</div>
            </div>
            <div className="rounded-lg bg-panel2 p-3">
              <div className="text-xl font-bold">{d.ports}</div>
              <div className="text-xs text-mut">Port</div>
            </div>
            <div className="rounded-lg bg-panel2 p-3">
              <div className="text-xl font-bold text-emerald-400">{d.portsActive}</div>
              <div className="text-xs text-mut">Port Aktif</div>
            </div>
          </div>
        </Card>
        <Card>
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
    </div>
  );
}
