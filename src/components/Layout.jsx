import { NavLink, useNavigate } from "react-router-dom";
import {
  Boxes,
  Cable,
  FileText,
  LayoutDashboard,
  LogOut,
  Network,
  Server,
  Users as UsersIcon,
  Workflow,
  Zap,
} from "lucide-react";
import { useAuth } from "../lib/auth.jsx";
import { getStoredUser } from "../lib/api.js";
import ThemeMenu from "./ThemeMenu.jsx";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/olt", label: "OLT", icon: Server },
  { to: "/odc", label: "ODC", icon: Boxes },
  { to: "/odp", label: "ODP", icon: Network },
  { to: "/mapping", label: "Mapping Core", icon: Workflow },
  { to: "/topologi", label: "Topologi", icon: Cable },
  { to: "/laporan", label: "Laporan", icon: FileText },
];

export default function Layout({ children }) {
  const { user: ctxUser, signOut } = useAuth();
  const user = ctxUser ?? getStoredUser();
  const navigate = useNavigate();
  const nav = user?.role === "admin" ? [...NAV, { to: "/users", label: "User", icon: UsersIcon }] : NAV;

  return (
    <div className="flex min-h-screen">
      <aside className="sidebar fixed inset-y-0 left-0 z-10 flex w-60 flex-col border-r border-line">
        <div className="flex items-center gap-2 border-b border-line px-4 py-4">
          <span className="brand-mark flex size-9 items-center justify-center rounded-lg">
            <Zap size={18} />
          </span>
          <div className="text-sm font-bold leading-tight">Fiber Manajement Core</div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `navlink ${isActive ? "navlink-active" : ""}`}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <div className="mb-2 px-2">
            <div className="truncate text-sm font-medium">{user?.full_name}</div>
            <div className="truncate text-xs text-mut">
              {user?.email} · {user?.role}
            </div>
          </div>
          <button
            className="btn w-full"
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            <LogOut size={14} /> Keluar
          </button>
        </div>
      </aside>
      <main className="ml-60 flex-1">
        <header className="topbar sticky top-0 z-30 flex h-12 items-center justify-between gap-3 px-6">
          <span className="text-xs text-mut">Manajemen jaringan fiber optik</span>
          <ThemeMenu />
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
