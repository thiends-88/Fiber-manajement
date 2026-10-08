import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Boxes,
  Cable,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Users as UsersIcon,
  Workflow,
  X,
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

const KUNCI_CIUT = "fiberops.sidebar.collapse";

/**
 * Tata letak utama.
 *
 * Responsif pada tiga keadaan:
 *   • HP / tablet (< 1024px): bilah samping disembunyikan dan muncul sebagai
 *     LACI (drawer) dari kiri; layar di belakangnya diredupkan.
 *   • Desktop, terbuka  : bilah samping 240px, ikon + label.
 *   • Desktop, diciutkan: bilah samping 72px, ikon saja (hemat ruang untuk
 *     tabel & topologi yang lebar). Pilihan ini diingat di localStorage.
 *
 * Kolom isi diberi `min-w-0` supaya tabel lebar menggulir ke samping di dalam
 * kartunya sendiri, bukan mendorong/mengoyak tata letak halaman.
 */
export default function Layout({ children }) {
  const { user: ctxUser, signOut } = useAuth();
  const user = ctxUser ?? getStoredUser();
  const navigate = useNavigate();
  const location = useLocation();
  const nav = user?.role === "admin" ? [...NAV, { to: "/users", label: "User", icon: UsersIcon }] : NAV;

  // Desktop: bilah samping diciutkan (ikon saja). Diingat antar kunjungan.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(KUNCI_CIUT) === "1";
    } catch {
      return false;
    }
  });
  // HP: laci menu terbuka/tertutup.
  const [drawer, setDrawer] = useState(false);

  // Tutup laci setiap pindah halaman.
  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);

  // Saat laci terbuka: kunci gulir latar dan tutup dengan tombol Esc.
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [drawer]);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(KUNCI_CIUT, next ? "1" : "0");
      } catch {
        /* localStorage bisa diblokir (mode privat) — abaikan */
      }
      return next;
    });
  }

  const inisial = (user?.full_name || user?.email || "?")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      {/* Layar redup di belakang laci (HP saja) */}
      {drawer && (
        <div
          className="drawer-backdrop fixed inset-0 z-30 lg:hidden"
          role="presentation"
          onClick={() => setDrawer(false)}
        />
      )}

      <aside
        id="sidebar"
        className={`sidebar fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line ${
          drawer ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 ${collapsed ? "sidebar-mini lg:w-[4.5rem]" : "lg:w-60"}`}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-4">
          <span className="brand-mark flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Zap size={18} />
          </span>
          <div className="brand-text text-sm font-bold leading-tight">Fiber Manajement Core</div>
          <button
            className="ml-auto text-mut hover:text-ink lg:hidden"
            onClick={() => setDrawer(false)}
            aria-label="Tutup menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) => `navlink ${isActive ? "navlink-active" : ""}`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="navlink-text truncate">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <div className="user-block mb-2 px-2">
            <span className="user-avatar flex size-8 items-center justify-center rounded-full bg-panel2 text-xs font-semibold">
              {inisial}
            </span>
            <div className="user-text min-w-0">
              <div className="truncate text-sm font-medium">{user?.full_name}</div>
              <div className="truncate text-xs text-mut">
                {user?.email} · {user?.role}
              </div>
            </div>
          </div>
          <button
            className="btn w-full"
            title="Keluar"
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            <LogOut size={14} className="shrink-0" /> <span className="btn-label">Keluar</span>
          </button>
        </div>
      </aside>

      <main
        className={`min-w-0 flex-1 transition-[margin] duration-200 ${collapsed ? "lg:ml-[4.5rem]" : "lg:ml-60"}`}
      >
        <header className="topbar sticky top-0 z-30 flex h-12 items-center justify-between gap-3 px-3 sm:px-6">
          <div className="flex items-center gap-2">
            {/* HP: buka laci menu */}
            <button
              className="icon-btn lg:hidden"
              onClick={() => setDrawer(true)}
              aria-label="Buka menu"
              aria-expanded={drawer}
              aria-controls="sidebar"
            >
              <Menu size={18} />
            </button>
            {/* Desktop: ciutkan / bentangkan bilah samping */}
            <button
              className="icon-btn hidden lg:inline-flex"
              onClick={toggleCollapse}
              aria-label={collapsed ? "Bentangkan bilah samping" : "Ciutkan bilah samping"}
              aria-expanded={!collapsed}
              aria-controls="sidebar"
              title={collapsed ? "Bentangkan bilah samping" : "Ciutkan bilah samping"}
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <span className="hidden text-xs text-mut sm:inline">Manajemen jaringan fiber optik</span>
          </div>
          <ThemeMenu />
        </header>
        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
