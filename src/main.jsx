import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./lib/auth.jsx";
import { applyTheme, getPrefs } from "./lib/theme.js";
import "./styles.css";

// Terapkan mode + warna tersimpan SEBELUM render supaya tidak berkedip
applyTheme(getPrefs());

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
