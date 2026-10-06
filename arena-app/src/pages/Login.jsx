import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap } from "lucide-react";
import { useAuth } from "../lib/auth.jsx";

const DEMO_ACCOUNTS = [
  { label: "Admin", email: "admin@arena.test", password: "Arena123!" },
  { label: "Operator", email: "operator@arena.test", password: "Arena123!" },
];

export default function Login() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signIn(email, password);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="card p-6">
          <div className="mb-5 text-center">
            <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-acc/15 text-acc">
              <Zap size={22} />
            </span>
            <h1 className="text-xl font-bold">FiberOps Arena</h1>
            <p className="mt-1 text-sm text-mut">Manajemen jaringan fiber optik — versi mandiri</p>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <div className="rounded-lg border border-red-500/40 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</div>}
            <button className="btn btn-primary w-full" disabled={loading}>
              {loading ? "Memproses…" : "Masuk"}
            </button>
          </form>
          <div className="mt-5 border-t border-line pt-4">
            <div className="mb-2 text-xs text-mut">Akun demo (klik untuk mengisi):</div>
            <div className="flex gap-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  className="btn flex-1 text-xs"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword(a.password);
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-mut">
          Database SQLite lokal · tidak terhubung ke Supabase
        </p>
      </div>
    </div>
  );
}
