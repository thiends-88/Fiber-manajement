import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { email: string; password: string; fullName: string; role: "admin" | "operator" | "user" }) => input,
  )
  .handler(async ({ data, context }) => {
    const email = data.email.trim().toLowerCase();
    const fullName = data.fullName.trim();
    const role = data.role;
    if (!email || !email.includes("@")) throw new Error("Email tidak valid");
    if (!fullName) throw new Error("Nama lengkap wajib diisi");
    if (!["admin", "operator", "user"].includes(role)) throw new Error("Peran tidak valid");
    if (data.password.length < 8) throw new Error("Password minimal 8 karakter");

    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: hanya admin yang dapat menambah user");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const createAuthUser = async (password: string) =>
      supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

    const isWeakPasswordError = (message: string) => {
      const lower = message.toLowerCase();
      return lower.includes("weak") || lower.includes("pwned") || lower.includes("easy to guess") || lower.includes("password") && lower.includes("guess");
    };

    const makeTemporaryPassword = () => {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_=+";
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      const random = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
      return `Fb1@${random}`;
    };

    let temporaryPassword: string | null = null;
    let { data: created, error } = await createAuthUser(data.password);
    if (error && isWeakPasswordError(error.message)) {
      temporaryPassword = makeTemporaryPassword();
      ({ data: created, error } = await createAuthUser(temporaryPassword));
    }
    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("signup") && message.includes("disabled")) {
        throw new Error("Pembuatan akun belum aktif di backend. Coba simpan lagi beberapa saat.");
      }
      if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
        throw new Error("Email sudah terdaftar. Gunakan email lain.");
      }
      if (isWeakPasswordError(error.message)) {
        throw new Error("Password ditolak oleh proteksi keamanan. Coba password yang lebih unik.");
      }
      throw new Error(error.message);
    }
    const userId = created.user?.id;
    if (!userId) throw new Error("Gagal membuat user");

    // Try using authenticated context first, fall back to service role if needed
    let profileErr, delErr, insErr;
    
    try {
      const result = await context.supabase.from("profiles").upsert({
        id: userId,
        email,
        full_name: fullName || email,
      });
      profileErr = result.error;
    } catch (e) {
      profileErr = e;
    }
    
    if (profileErr) {
      console.error("[createUser] upsert profile failed with auth client, trying service role", profileErr);
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await supabaseAdmin.from("profiles").upsert({
          id: userId,
          email,
          full_name: fullName || email,
        });
        profileErr = result.error;
      } catch (e) {
        console.error("[createUser] service role also failed", e);
      }
      if (profileErr) {
        throw new Error(`Gagal membuat profil user: ${(profileErr as { message?: string })?.message}`);
      }
    }

    // Ensure the role exactly matches the selected menu option.
    try {
      const result = await context.supabase.from("user_roles").delete().eq("user_id", userId);
      delErr = result.error;
    } catch (e) {
      delErr = e;
    }
    
    if (delErr) {
      console.error("[createUser] delete existing role failed with auth client, trying service role", delErr);
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
        delErr = result.error;
      } catch (e) {
        console.error("[createUser] service role also failed", e);
      }
      if (delErr) {
        throw new Error(`Gagal menghapus role lama: ${(delErr as { message?: string })?.message}`);
      }
    }
    
    try {
      const result = await context.supabase.from("user_roles").insert({ user_id: userId, role });
      insErr = result.error;
    } catch (e) {
      insErr = e;
    }
    
    if (insErr) {
      console.error("[createUser] insert role failed with auth client, trying service role", insErr);
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role });
        insErr = result.error;
      } catch (e) {
        console.error("[createUser] service role also failed", e);
      }
      if (insErr) {
        throw new Error(`Gagal menetapkan role ${role}: ${(insErr as { message?: string })?.message}`);
      }
    }
    return { id: userId, temporaryPassword };
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { userId: string; email: string; fullName: string; role: "admin" | "operator" | "user" }) => input,
  )
  .handler(async ({ data, context }) => {
    const email = data.email.trim().toLowerCase();
    const fullName = data.fullName.trim();
    if (!data.userId) throw new Error("User tidak valid");
    if (!email || !email.includes("@")) throw new Error("Email tidak valid");
    if (!fullName) throw new Error("Nama lengkap wajib diisi");
    if (!["admin", "operator", "user"].includes(data.role)) throw new Error("Peran tidak valid");

    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden: hanya admin yang dapat mengedit user");
    if (data.userId === context.userId && data.role !== "admin") {
      throw new Error("Administrator tidak dapat menurunkan peran akunnya sendiri");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (authError) throw new Error(`Gagal memperbarui akun: ${authError.message}`);

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: data.userId,
      email,
      full_name: fullName,
    });
    if (profileError) throw new Error(`Gagal memperbarui profil: ${profileError.message}`);

    const { error: deleteRoleError } = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    if (deleteRoleError) throw new Error(`Gagal memperbarui peran: ${deleteRoleError.message}`);
    const { error: insertRoleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (insertRoleError) throw new Error(`Gagal menetapkan peran: ${insertRoleError.message}`);

    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    if (data.userId === context.userId) throw new Error("Tidak bisa menghapus akun sendiri");
    
    // Try using authenticated context first, fall back to service role if needed
    let roleErr, profileErr;
    
    try {
      const result = await context.supabase.from("user_roles").delete().eq("user_id", data.userId);
      roleErr = result.error;
    } catch (e) {
      roleErr = e;
    }
    
    if (roleErr) {
      console.error("[deleteUser] delete role failed with auth client, trying service role", roleErr);
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
        roleErr = result.error;
      } catch (e) {
        console.error("[deleteUser] service role also failed", e);
      }
      if (roleErr) {
        throw new Error(`Gagal menghapus role user: ${(roleErr as { message?: string })?.message}`);
      }
    }
    
    try {
      const result = await context.supabase.from("profiles").delete().eq("id", data.userId);
      profileErr = result.error;
    } catch (e) {
      profileErr = e;
    }
    
    if (profileErr) {
      console.error("[deleteUser] delete profile failed with auth client, trying service role", profileErr);
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await supabaseAdmin.from("profiles").delete().eq("id", data.userId);
        profileErr = result.error;
      } catch (e) {
        console.error("[deleteUser] service role also failed", e);
      }
      if (profileErr) {
        throw new Error(`Gagal menghapus profil user: ${(profileErr as { message?: string })?.message}`);
      }
    }
    
    return { ok: true };
  });
