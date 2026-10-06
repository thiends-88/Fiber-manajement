import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    const roleList = (roles ?? []).map((r) => r.role);
    if (roleList.length === 0) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    return {
      user: data.user,
      roles: roleList,
      isAdmin: roleList.includes("admin"),
    };
  },
  component: () => <Outlet />,
});
