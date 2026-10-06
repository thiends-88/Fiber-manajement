import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { Badge, Card, Field, Modal, PageHeader, Toast, useToast } from "../components/ui.jsx";

const ROLES = ["admin", "operator", "user"];
const empty = { email: "", password: "", full_name: "", role: "user" };

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [toastState, setToastState] = useState(null);
  const toast = useToast(setToastState);

  const load = useCallback(() => api("/api/users").then(setUsers), []);
  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, [load, toast]);

  if (me.role !== "admin") {
    return <Card className="p-6 text-sm text-mut">Hanya admin yang dapat membuka halaman ini.</Card>;
  }

  async function save(e) {
    e.preventDefault();
    try {
      if (modal.mode === "add") {
        await api("/api/users", { method: "POST", body: form });
      } else {
        await api(`/api/users/${modal.u.id}`, { method: "PATCH", body: { full_name: form.full_name, role: form.role } });
      }
      setModal(null);
      await load();
      toast("User tersimpan");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  async function remove(u) {
    if (!confirm(`Hapus user ${u.email}?`)) return;
    try {
      await api(`/api/users/${u.id}`, { method: "DELETE" });
      await load();
      toast("User dihapus");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  return (
    <div>
      <PageHeader title="Manajemen User" desc="Kelola akun dan peran.">
        <button
          className="btn btn-primary"
          onClick={() => {
            setForm(empty);
            setModal({ mode: "add" });
          }}
        >
          <Plus size={15} /> Tambah User
        </button>
      </PageHeader>

      <Card className="overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-line">
            <tr>
              <th className="th">Nama</th>
              <th className="th">Email</th>
              <th className="th">Peran</th>
              <th className="th">Dibuat</th>
              <th className="th">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line/50 last:border-0">
                <td className="td font-medium">{u.full_name}</td>
                <td className="td text-mut">{u.email}</td>
                <td className="td">
                  <Badge
                    cls={
                      u.role === "admin"
                        ? "bg-cyan-500/15 text-cyan-300"
                        : u.role === "operator"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-slate-500/15 text-slate-300"
                    }
                  >
                    {u.role}
                  </Badge>
                </td>
                <td className="td text-mut">{String(u.created_at).slice(0, 10)}</td>
                <td className="td">
                  <div className="flex gap-1">
                    <button
                      className="btn px-2 py-1"
                      onClick={() => {
                        setForm({ email: u.email, password: "", full_name: u.full_name, role: u.role });
                        setModal({ mode: "edit", u });
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    {u.id !== me.id && (
                      <button className="btn px-2 py-1 text-red-400" onClick={() => remove(u)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={!!modal} title={modal?.mode === "add" ? "Tambah User" : "Edit User"} onClose={() => setModal(null)}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              disabled={modal?.mode === "edit"}
            />
          </Field>
          {modal?.mode === "add" && (
            <Field label="Password (min. 8 karakter)">
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
              />
            </Field>
          )}
          <Field label="Nama Lengkap">
            <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
          </Field>
          <Field label="Peran">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <button className="btn btn-primary w-full">Simpan</button>
        </form>
      </Modal>

      <Toast toast={toastState} />
    </div>
  );
}
