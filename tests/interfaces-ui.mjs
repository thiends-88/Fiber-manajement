import { JSDOM } from "jsdom";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-interface-ui-"));
const PORT = process.env.UJI_INTERFACE_UI_PORT || "4797";
const BASE = `http://127.0.0.1:${PORT}`;
const nodeFetch = globalThis.fetch;
let token, dom, output = "";
const server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, ARENA_DB_PATH: path.join(TMP, "uji.db"), ARENA_API_HOST: "127.0.0.1", ARENA_API_PORT: PORT }, stdio: ["ignore", "pipe", "pipe"] });
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Server uji belum siap: ${output}`)), 15000);
  server.stdout.on("data", (d) => { output += d; if (output.includes("siap di")) { clearTimeout(timer); resolve(); } });
  server.stderr.on("data", (d) => { output += d; });
  server.on("error", (e) => { clearTimeout(timer); reject(e); });
  server.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Server uji berhenti: ${code}\n${output}`)); });
});
async function request(method, route, body) {
  const r = await nodeFetch(BASE + route, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(`${method} ${route}: ${r.status} ${JSON.stringify(data)}`);
  return data;
}
try {
  await ready;
  const admin = await request("POST", "/api/login", { email: "admin@arena.test", password: "Arena123!" });
  token = admin.token;
  const olt = (await request("GET", "/api/olts")).find((o) => o.name === "OLT-PST-01");
  const odc = (await request("GET", "/api/odcs")).find((d) => d.name === "ODC-001");
  const firstPort = (await request("GET", `/api/ports?olt_id=${olt.id}`)).find((p) => p.slot === 1 && p.port === 1);
  const directOdp = await request("POST", "/api/odps", { name: "ODP-UI-LANGSUNG", odc_id: odc.id, cable_type: "12_core_2_tube" });
  await request("POST", "/api/users", { email: "reader-ui@test.local", full_name: "Teknisi Baca UI", password: "UjiInterface123!", role: "user" });
  const reader = await request("POST", "/api/login", { email: "reader-ui@test.local", password: "UjiInterface123!" });
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: BASE, pretendToBeVisual: true });
  const { window } = dom;
  window.localStorage.setItem("fiberops_arena_token", admin.token);
  window.localStorage.setItem("fiberops_arena_user", JSON.stringify(admin.user));
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {};
  window.confirm = () => true;
  window.fetch = (u, options) => nodeFetch(new URL(String(u), BASE), options);
  for (const key of ["window", "document", "localStorage", "location", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "ResizeObserver", "IntersectionObserver", "fetch", "confirm"]) {
    Object.defineProperty(globalThis, key, { value: typeof window[key] === "function" && ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"].includes(key) ? window[key].bind(window) : window[key], writable: true, configurable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  console.log("\n=== UJI INTERAKSI UI INTERFACE (database sementara) ===");
  const { run } = await import("../.uji-interfaces/interfaces-ui.js");
  await run({ request, olt, odc, firstPort, directOdp, reader });
} finally {
  dom?.window.close();
  if (server.exitCode == null && server.signalCode == null) { const exit = once(server, "exit"); server.kill(); await exit; }
  fs.rmSync(TMP, { recursive: true, force: true });
}
