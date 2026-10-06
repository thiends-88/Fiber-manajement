import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Server, Boxes, Network, ChevronRight } from "lucide-react";
import { getCableInfo } from "@/lib/fiber";

export const Route = createFileRoute("/_authenticated/topologi")({
  head: () => ({ meta: [{ title: "Topologi – FiberOps" }] }),
  component: TopologyPage,
});

function TopologyPage() {
  const { data } = useQuery({
    queryKey: ["topology"],
    queryFn: async () => {
      const [olts, odcs, odps, cores] = await Promise.all([
        supabase.from("olts").select("*").order("name"),
        supabase.from("odcs").select("*"),
        supabase.from("odps").select("*"),
        supabase.from("core_assignments").select("odc_id,odp_id,source,status"),
      ]);
      return {
        olts: olts.data ?? [],
        odcs: odcs.data ?? [],
        odps: odps.data ?? [],
        cores: cores.data ?? [],
      };
    },
  });

  const usedCount = (source: "olt_to_odc" | "odc_to_odp", id: string) =>
    (data?.cores ?? []).filter((c) =>
      c.source === source && (source === "olt_to_odc" ? c.odc_id === id : c.odp_id === id) && c.status === "used",
    ).length;

  return (
    <AppLayout>
      <PageHeader title="Topologi Jaringan" description="Peta hierarki OLT → ODC → ODP dengan jumlah core terpakai." />

      {(!data || data.olts.length === 0) ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">Belum ada data untuk ditampilkan.</CardContent></Card>
      ) : (
        <div className="space-y-6">
          {data.olts.map((olt) => {
            const oltOdcs = data.odcs.filter((o) => o.olt_id === olt.id);
            return (
              <Card key={olt.id}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="size-11 rounded-md bg-primary/15 text-primary flex items-center justify-center">
                      <Server className="size-5" />
                    </div>
                    <div>
                      <div className="font-semibold">{olt.name}</div>
                      <div className="text-xs text-muted-foreground">{olt.location ?? "-"}</div>
                    </div>
                  </div>

                  {oltOdcs.length === 0 ? (
                    <div className="mt-4 ml-4 text-xs text-muted-foreground italic">Belum ada ODC terhubung.</div>
                  ) : (
                    <div className="mt-4 ml-4 md:ml-6 space-y-3 border-l-2 border-primary/30 pl-4 md:pl-6">
                      {oltOdcs.map((odc) => {
                        const info = getCableInfo(odc.cable_type);
                        const cableUsed = usedCount("olt_to_odc", odc.id);
                        const odcOdps = data.odps.filter((p) => p.odc_id === odc.id);
                        return (
                          <div key={odc.id}>
                            <div className="flex items-center gap-3 py-2">
                              <div className="size-9 rounded-md bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                                <Boxes className="size-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm">{odc.name}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {info?.label} · {cableUsed}/{info?.cores ?? "?"} core terpakai
                                </div>
                              </div>
                              <ChevronRight className="size-4 text-muted-foreground" />
                            </div>

                            {odcOdps.length > 0 && (
                              <div className="ml-4 md:ml-6 space-y-1 border-l-2 border-emerald-500/30 pl-4 md:pl-6">
                                {odcOdps.map((odp) => {
                                  const oi = getCableInfo(odp.cable_type);
                                  const u = usedCount("odc_to_odp", odp.id);
                                  return (
                                    <div key={odp.id} className="flex items-center gap-3 py-1.5">
                                      <div className="size-8 rounded-md bg-amber-500/15 text-amber-400 flex items-center justify-center">
                                        <Network className="size-4" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm">{odp.name}</div>
                                        <div className="text-xs text-muted-foreground truncate">
                                          {oi?.label} · {u}/{oi?.cores ?? "?"} core terpakai
                                        </div>
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
