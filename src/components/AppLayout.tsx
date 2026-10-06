import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { LOGO_URL } from "@/lib/logo";
import {
  LayoutDashboard,
  Server,
  Boxes,
  Network,
  Cable,
  FileBarChart,
  Radio,
  Users,
  LogOut,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/olt", label: "OLT", icon: Server },
  { to: "/odc", label: "ODC", icon: Boxes },
  { to: "/odp", label: "ODP", icon: Network },
  { to: "/topologi", label: "Topologi", icon: Cable },
  { to: "/laporan", label: "Laporan", icon: FileBarChart },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { location } = useRouterState();
  const navigate = useNavigate();
  const [me, setMe] = useState<{ email: string; isAdmin: boolean; isOperator: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { data: roles } = await supabase
        .from("user_roles").select("role").eq("user_id", data.user.id);
      const list = (roles ?? []).map((r) => r.role);
      setMe({
        email: data.user.email ?? "",
        isAdmin: list.includes("admin"),
        isOperator: list.includes("operator"),
      });
    })();
  }, []);

  const nav: NavItem[] = me?.isAdmin
    ? [...NAV, { to: "/users", label: "User", icon: Users }]
    : NAV;

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="px-5 h-16 flex items-center gap-2 border-b border-sidebar-border">
          <img src={LOGO_URL} alt="Cinox Media Network" className="size-9 object-contain" />
          <div>
            <div className="text-sm font-semibold leading-tight">FiberOps</div>
            <div className="text-[11px] text-muted-foreground">Fiber Optic Manager</div>
          </div>
        </div>
        <nav className="p-3 space-y-1 flex-1">
          {nav.map(({ to, label, icon: Icon, exact }) => {
            const active = exact ? location.pathname === to : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          {me && (
            <div className="flex items-center gap-2 px-2 py-1.5">
              {me.isAdmin ? <ShieldCheck className="size-4 text-primary" /> : <UserIcon className={cn("size-4", me.isOperator ? "text-emerald-400" : "text-muted-foreground")} />}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{me.email}</div>
                <Badge variant={me.isAdmin ? "default" : me.isOperator ? "outline" : "secondary"} className="text-[10px] mt-0.5">
                  {me.isAdmin ? "Administrator" : me.isOperator ? "Operator" : "User (Read-only)"}
                </Badge>
              </div>
            </div>
          )}
          <Button size="sm" variant="outline" className="w-full" onClick={signOut}>
            <LogOut className="size-4 mr-1" /> Keluar
          </Button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden h-14 border-b border-border bg-sidebar px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={LOGO_URL} alt="Cinox Media Network" className="size-6 object-contain" />
            <span className="font-semibold">FiberOps</span>
          </div>
          <Button size="sm" variant="ghost" onClick={signOut}>
            <LogOut className="size-4" />
          </Button>
        </header>
        <nav className="md:hidden overflow-x-auto flex gap-1 border-b border-border bg-sidebar px-2 py-2">
          {nav.map(({ to, label, icon: Icon, exact }) => {
            const active = exact ? location.pathname === to : location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap",
                  active ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
