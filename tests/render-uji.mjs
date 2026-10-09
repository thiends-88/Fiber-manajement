// Uji render (smoke test) semua halaman aplikasi memakai jsdom + data nyata
// dari server Arena. Tujuan: memastikan TIDAK ADA halaman yang blank / error
// render (mis. "X is not defined") saat memakai data sungguhan.
//
// Cara pakai:
//   1) jalankan server:  ARENA_API_PORT=8080 node server.mjs
//   2) npm run test:render          (port lain: ARENA_API_PORT=3000 npm run test:render)
import { JSDOM } from "jsdom";

const PORT = process.env.ARENA_API_PORT || "8080";
const API = `http://127.0.0.1:${PORT}`;
const nodeFetch = globalThis.fetch; // simpan fetch asli SEBELUM global ditimpa (cegah rekursi)

async function login() {
  const r = await nodeFetch(`${API}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@arena.test", password: "Arena123!" }),
  });
  if (!r.ok) throw new Error(`login demo gagal (${r.status})`);
  return r.json();
}

function siapkanDom(token, user) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `${API}/`,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem("fiberops_arena_token", token);
  window.localStorage.setItem("fiberops_arena_user", JSON.stringify(user));
  window.matchMedia =
    window.matchMedia ||
    (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {};
  window.fetch = (u, o) => nodeFetch(String(u).startsWith("http") ? u : API + u, o);

  const KEYS = [
    "window", "document", "localStorage", "location", "HTMLElement", "Element", "Node", "Event",
    "CustomEvent", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame",
    "cancelAnimationFrame", "matchMedia", "ResizeObserver", "IntersectionObserver", "fetch",
  ];
  for (const k of KEYS) {
    try {
      globalThis[k] = window[k];
    } catch {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    }
  }
  // React 19: pembaruan state dari promise tertahan bila pakai act() di jsdom,
  // jadi uji ini memakai timer nyata tanpa act() (cukup untuk mendeteksi blank page).
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  return dom;
}

async function main() {
  try {
    await nodeFetch(`${API}/api/dashboard`);
  } catch {
    console.error(`Server tidak jalan di ${API}. Jalankan dulu: ARENA_API_PORT=${PORT} node server.mjs`);
    process.exit(2);
  }

  const { token, user } = await login();
  const dom = siapkanDom(token, user);
  const { run, renderOne } = await import("../.uji-out/render-uji.js");
  const hasil = await run();

  let gagal = 0;
  console.log("=== UJI RENDER SEMUA HALAMAN ===");
  for (const r of hasil) {
    if (!r.ok) gagal++;
    console.log(
      `${r.ok ? "OK   " : "GAGAL"} ${r.route.padEnd(11)} ${String(r.chars).padStart(5)} karakter  ` +
        (r.ok ? `"${r.sample}…"` : `→ ${r.problem}`),
    );
  }

  const operatorResponse = await nodeFetch(`${API}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "operator@arena.test", password: "Arena123!" }),
  });
  const operatorSession = await operatorResponse.json();
  dom.window.localStorage.setItem("fiberops_arena_token", operatorSession.token);
  dom.window.localStorage.setItem("fiberops_arena_user", JSON.stringify(operatorSession.user));
  const operatorUsersPage = await renderOne("/users", 1500);
  const operatorBlocked = operatorResponse.ok && operatorUsersPage.text.includes("Alur Core") && !operatorUsersPage.text.includes("Manajemen User");
  if (!operatorBlocked) gagal++;
  console.log(`${operatorBlocked ? "OK   " : "GAGAL"} /users operator dialihkan sebelum memuat halaman admin`);

  console.log(gagal === 0 ? "\nSEMUA HALAMAN TAMPIL NORMAL" : `\n${gagal} HALAMAN BERMASALAH`);
  process.exit(gagal ? 1 : 0);
}

main();
