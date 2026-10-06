import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, Boxes, Network, Cable } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard – FiberOps" },
      { name: "description", content: "Manajemen fiber optik OLT–ODC–ODP." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [olts, odcs, odps, cores] = await Promise.all([
        supabase.from("olts").select("id", { count: "exact", head: true }),
        supabase.from("odcs").select("id", { count: "exact", head: true }),
        supabase.from("odps").select("id", { count: "exact", head: true }),
        supabase.from("core_assignments").select("status"),
      ]);
      const used = cores.data?.filter((c) => c.status === "used").length ?? 0;
      const idle = cores.data?.filter((c) => c.status === "idle").length ?? 0;
      const damaged = cores.data?.filter((c) => c.status === "damaged").length ?? 0;
      return {
        olt: olts.count ?? 0,
        odc: odcs.count ?? 0,
        odp: odps.count ?? 0,
        cores: cores.data?.length ?? 0,
        used,
        idle,
        damaged,
      };
    },
  });

  const stats = [
    { label: "OLT", value: data?.olt ?? 0, icon: Server, to: "/olt", color: "text-cyan-400" },
    { label: "ODC", value: data?.odc ?? 0, icon: Boxes, to: "/odc", color: "text-emerald-400" },
    { label: "ODP", value: data?.odp ?? 0, icon: Network, to: "/odp", color: "text-amber-400" },
    { label: "Core Terdaftar", value: data?.cores ?? 0, icon: Cable, to: "/laporan", color: "text-fuchsia-400" },
  ];

  return (
    <AppLayout>
      <PageHeader
        title="Dashboard"
        description="Ringkasan jaringan fiber optik: OLT, ODC, ODP, dan penggunaan core."
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.to}>
            <Card className="hover:border-primary/50 transition-colors">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </div>
                    <div className="text-3xl font-bold mt-1">{s.value}</div>
                  </div>
                  <s.icon className={`size-8 ${s.color}`} />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-4 mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Core Terpakai</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-400">{data?.used ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Core Idle</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data?.idle ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Core Rusak</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-400">{data?.damaged ?? 0}</div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
