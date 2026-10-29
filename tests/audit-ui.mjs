// SQLite nyata + jsdom, semuanya di database sementara (bukan data preview).
import { JSDOM } from "jsdom";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-audit-ui-"));
const PORT = process.env.UJI_AUDIT_UI_PORT || "4795", BASE = `http://127.0.0.1:${PORT}`;
const nodeFetch = globalThis.fetch;
let token, dom, output = "";
const server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, ARENA_DB_PATH: path.join(TMP, "audit.db"), ARENA_API_HOST: "127.0.0.1", ARENA_API_PORT: PORT }, stdio: ["ignore", "pipe", "pipe"] });
async function request(method, route, body) {
  const r = await nodeFetch(BASE + route, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw Error(`${method} ${route}: ${r.status} ${JSON.stringify(data)}`); return data;
}
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(output)), 15000);
    server.stdout.on("data", d => { output += d; if (output.includes("siap di")) { clearTimeout(timer); resolve(); } });
    server.stderr.on("data", d => { output += d; });
    server.once("error", e => { clearTimeout(timer); reject(e); });
    server.once("exit", code => { clearTimeout(timer); reject(Error(`Server ${code}: ${output}`)); });
  });
  const admin = await request("POST", "/api/login", { email: "admin@arena.test", password: "Arena123!" }); token = admin.token;
  await request("POST", "/api/users", { email: "audit-reader@test.local", full_name: "Teknisi Audit", password: "Audit123!", role: "user" });
  const reader = await request("POST", "/api/login", { email: "audit-reader@test.local", password: "Audit123!" });
  const olt = await request("POST", "/api/olts", { name: "OLT-AUDIT-UI", olt_type: "ZTE C320" });
  const fixtures = [];
  for (const [suffix, status] of [["A", "damaged"], ["B", "reserved"]]) {
    const d = await request("POST", "/api/odcs", { name: `ODC-AUDIT-UI-${suffix}`, olt_id: olt.id, cable_type: "figure8_6_core" });
    const p = await request("POST", "/api/odps", { name: `ODP-AUDIT-UI-${suffix}`, odc_id: d.id, cable_type: "figure8_6_core" });
    const s = await request("POST", "/api/splitters", { name: `SPL-AUDIT-UI-${suffix}`, odc_id: d.id, ratio: "1:4", input_core: 2 });
    await request("POST", "/api/links", { odc_id: d.id, odc_core: 1, odp_id: p.id, odp_core: 1, notes: `closure-${suffix}` });
    for (const source of ["olt_to_odc", "odc_to_odp"]) {
      await request("POST", "/api/cores", { source, odc_id: source === "olt_to_odc" ? d.id : null, odp_id: source === "odc_to_odp" ? p.id : null, core: 3, status, notes: `Catatan-${suffix}` });
    }
    fixtures.push({ d, p, s });
  }
  const hardware = [];
  for (const [i, device] of [olt, await request("POST", "/api/olts", { name: "OLT-AUDIT-UI-LAIN", olt_type: "ZTE C300" })].entries()) {
    const card = await request("POST", "/api/cards", { olt_id: device.id, shelf: 1, slot: i + 1, port_count: 8 });
    const port = await request("POST", "/api/ports", { card_id: card.id, port: 1 });
    hardware.push({ olt: device, card, port, label: `GPON 1/${i + 1}/1` });
  }
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: BASE, pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {}; window.confirm = () => true;
  window.fetch = (u, options = {}) => {
    const cookie = dom.cookieJar.getCookieStringSync(BASE);
    return nodeFetch(new URL(String(u), BASE), { ...options, headers: { ...options.headers, ...(cookie ? { cookie } : {}) } });
  };
  for (const key of ["window", "document", "localStorage", "location", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "ResizeObserver", "IntersectionObserver", "fetch", "confirm"]) {
    Object.defineProperty(globalThis, key, { value: typeof window[key] === "function" && ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"].includes(key) ? window[key].bind(window) : window[key], writable: true, configurable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const { run } = await import("../.uji-audit/audit-ui.js");
  await run({ request, admin, reader, fixtures, hardware, clearCookies: () => dom.cookieJar.removeAllCookiesSync(), setCookie: value => dom.cookieJar.setCookieSync(value, BASE) });
} finally {
  dom?.window.close();
  if (server.exitCode == null && server.signalCode == null) { const exited = once(server, "exit"); server.kill(); await exited; }
  fs.rmSync(TMP, { recursive: true, force: true });
}
