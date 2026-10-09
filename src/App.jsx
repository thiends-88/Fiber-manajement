import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth.jsx";
import { getStoredUser } from "./lib/api.js";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Olts from "./pages/Olts.jsx";
import Odcs from "./pages/Odcs.jsx";
import Odps from "./pages/Odps.jsx";
import Topologi from "./pages/Topologi.jsx";
import Mapping from "./pages/Mapping.jsx";
import Laporan from "./pages/Laporan.jsx";
import Users from "./pages/Users.jsx";

function Protected({ children }) {
  const { user } = useAuth();
  // Fallback ke localStorage: menghindari redirect keliru saat state context
  // belum ter-commit (mis. tepat setelah login).
  if (!user && !getStoredUser()) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Halaman utama = Alur Core (OLT → ODC → ODP), yang paling sering
          dibutuhkan teknisi. Dashboard ringkasan pindah ke /dashboard. */}
      <Route
        path="/"
        element={
          <Protected>
            <Topologi />
          </Protected>
        }
      />
      <Route
        path="/dashboard"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/olt"
        element={
          <Protected>
            <Olts />
          </Protected>
        }
      />
      <Route
        path="/odc"
        element={
          <Protected>
            <Odcs />
          </Protected>
        }
      />
      <Route
        path="/odp"
        element={
          <Protected>
            <Odps />
          </Protected>
        }
      />
      <Route
        path="/mapping"
        element={
          <Protected>
            <Mapping />
          </Protected>
        }
      />
      <Route
        path="/laporan"
        element={
          <Protected>
            <Laporan />
          </Protected>
        }
      />
      <Route
        path="/users"
        element={
          <Protected>
            <Users />
          </Protected>
        }
      />
      <Route path="/topologi" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
