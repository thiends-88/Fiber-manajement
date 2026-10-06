import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Copy, Pencil, Plus, Trash2, ShieldCheck, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { createUser, deleteUser, updateUser } from "@/lib/admin-users.functions";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Manajemen User – FiberOps" }] }),
  beforeLoad: ({ context }) => {
    if (!context.isAdmin) throw redirect({ to: "/" });
  },
  component: UsersPage,
});

function UsersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", password: "", fullName: "", role: "user" as "user" | "operator" | "admin" });
  const [editing, setEditing] = useState<null | { id: string; email: string; fullName: string; role: "user" | "operator" | "admin" }>(null);
  const createFn = useServerFn(createUser);
  const deleteFn = useServerFn(deleteUser);
  const updateFn = useServerFn(updateUser);

  const resetForm = () => {
    setForm({ email: "", password: "", fullName: "", role: "user" });
    setTemporaryPassword(null);
  };

  const closeDialog = () => {
    setOpen(false);
    resetForm();
  };

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name, created_at").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      return (profiles ?? []).map((p) => ({
        ...p,
        role: roles?.find((r) => r.user_id === p.id)?.role ?? "user",
      }));
    },
  });

  const createMut = useMutation({
    mutationFn: () => createFn({ data: form }),
    onSuccess: (result) => {
      toast.success("User berhasil dibuat");
      if (result.temporaryPassword) {
        setTemporaryPassword(result.temporaryPassword);
      } else {
        closeDialog();
      }
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (userId: string) => deleteFn({ data: { userId } }),
    onSuccess: () => {
      toast.success("User dihapus");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("User tidak valid");
      return updateFn({ data: { userId: editing.id, email: editing.email, fullName: editing.fullName, role: editing.role } });
    },
    onSuccess: () => {
      toast.success("User berhasil diperbarui dan akun sudah diaktifkan");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppLayout>
      <PageHeader
        title="Manajemen User"
        description="Kelola akun admin dan user (read-only)."
        actions={
          <Dialog open={open} onOpenChange={(value) => (value ? setOpen(true) : closeDialog())}>
            <DialogTrigger asChild>
              <Button><Plus className="size-4 mr-1" /> Tambah User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Tambah User Baru</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1"><Label>Nama Lengkap</Label>
                  <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
                <div className="space-y-1"><Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-1"><Label>Password</Label>
                  <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
                <div className="space-y-1"><Label>Peran</Label>
                  <Select value={form.role} onValueChange={(v: "admin" | "operator" | "user") => setForm({ ...form, role: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User (Read-only)</SelectItem>
                      <SelectItem value="operator">Operator (Tambah & Edit)</SelectItem>
                      <SelectItem value="admin">Administrator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {temporaryPassword && (
                  <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
                    <div className="text-sm font-medium">Password sementara dibuat otomatis</div>
                    <div className="flex gap-2">
                      <Input readOnly value={temporaryPassword} className="font-mono" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          navigator.clipboard.writeText(temporaryPassword);
                          toast.success("Password disalin");
                        }}
                        aria-label="Salin password sementara"
                      >
                        <Copy className="size-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Password yang diisi ditolak proteksi keamanan, jadi sistem membuat password unik ini. Simpan sekarang karena hanya ditampilkan sekali.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                {temporaryPassword ? (
                  <Button onClick={closeDialog}>Selesai</Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={closeDialog}>Batal</Button>
                    <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.email || form.password.length < 8}>
                      {createMut.isPending ? "Menyimpan..." : "Simpan"}
                    </Button>
                  </>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardContent className="p-0 divide-y">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-muted flex items-center justify-center">
                  {u.role === "admin" ? <ShieldCheck className="size-5 text-primary" /> : <UserIcon className={u.role === "operator" ? "size-5 text-emerald-400" : "size-5 text-muted-foreground"} />}
                </div>
                <div>
                  <div className="font-medium">{u.full_name || u.email}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={u.role === "admin" ? "default" : u.role === "operator" ? "outline" : "secondary"}>
                  {u.role === "admin" ? "Administrator" : u.role === "operator" ? "Operator" : "User"}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Edit ${u.email}`}
                  onClick={() => setEditing({
                    id: u.id,
                    email: u.email ?? "",
                    fullName: u.full_name ?? "",
                    role: u.role as "user" | "operator" | "admin",
                  })}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => {
                  if (confirm(`Hapus user ${u.email}?`)) deleteMut.mutate(u.id);
                }}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          {users.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">Belum ada user</div>}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(value) => { if (!value) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nama Lengkap</Label>
                <Input value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Peran</Label>
                <Select value={editing.role} onValueChange={(role: "admin" | "operator" | "user") => setEditing({ ...editing, role })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User (Read-only)</SelectItem>
                    <SelectItem value="operator">Operator (Tambah & Edit)</SelectItem>
                    <SelectItem value="admin">Administrator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Batal</Button>
            <Button
              onClick={() => updateMut.mutate()}
              disabled={updateMut.isPending || !editing?.email || !editing.fullName}
            >
              {updateMut.isPending ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
