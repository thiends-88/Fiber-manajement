import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function useRoles() {
  const { data } = useQuery({
    queryKey: ["my-roles"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return [] as string[];
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id);
      return (roles ?? []).map((r) => r.role as string);
    },
  });
  return data ?? [];
}

/** Admin only — used to gate delete actions and admin-only screens. */
export function useIsAdmin() {
  return useRoles().includes("admin");
}

/** Admin OR operator — used to gate add/edit/save actions. */
export function useCanWrite() {
  const roles = useRoles();
  return roles.includes("admin") || roles.includes("operator");
}
