// Browser production + worker nyata. Semua data geografis adalah fixture sintetis.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";
import { JSDOM } from "jsdom";
import {
  SATELLITE_FIXTURE_PNG,
  isSatelliteTile,
  assertSatelliteRequest,
} from "./satellite-tiles.mjs";
import { unzipSync, strFromU8, strToU8, zipSync } from "fflate";
const ROOT = path.resolve(import.meta.dirname, ".."),
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-routes-browser-")),
  DB = path.join(TMP, "fixture.db");
const PORT = Number(process.env.UJI_ROUTES_BROWSER_PORT || 4912),
  BASE = `http://127.0.0.1:${PORT}`;
const artifacts =
  process.env.ROUTES_BROWSER_ARTIFACTS || path.join(TMP, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const email = "owner-routes@browser.test",
  password = "PrivateRoutesBrowser123!",
  readerEmail = "reader-routes@browser.test",
  readerPassword = "PrivateRoutesReader123!";
const evil = '<img src=x onerror="window.__routeXss=1">';
const quote = (value) => '"' + String(value).replaceAll('"', '""') + '"';
const coordinateRows = Array.from({ length: 29 }, (_, i) =>
  Array.from({ length: i < 23 ? 32 : 31 }, (_, j) => [
    10 + i * 0.0006 + j * 0.00008,
    -5 - i * 0.0003 - Math.sin(j / 4) * 0.001 - j * 0.00006,
  ]),
);
const csv =
  "Name,Type,Coordinates,Description\r\n" +
  coordinateRows
    .map((points, i) =>
      [
        quote(i === 0 ? evil : "ADSS UJI " + (i % 3 === 0 ? "48" : "24")),
        "line",
        quote(points.map((p) => p.join(",")).join(";")),
        quote(i < 22 ? "Catatan sintetis, bukan inventaris produksi" : ""),
      ].join(","),
    )
    .join("\r\n");
const kml =
  '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Style id="test"><LineStyle><color>ff332211</color></LineStyle></Style><Folder><name>Area sintetis</name><Placemark><name>KML UJI</name><styleUrl>#test</styleUrl><LineString><coordinates>10.04,-5.02,0 10.045,-5.025,0</coordinates></LineString></Placemark><Placemark><name>Titik tidak diimpor</name><Point><coordinates>10.04,-5.02</coordinates></Point></Placemark></Folder></Document></kml>';
let app,
  browser,
  token,
  debugPage,
  passed = 0,
  external = 0;
const tileCalls = [];
const requests = [],
  exceptions = [];
process.once("exit", () => {
  if (app && app.exitCode == null && app.signalCode == null) app.kill();
});
async function check(name, fn) {
  await fn();
  passed++;
  console.log("OK   ", name);
}
async function start() {
  let log = "";
  app = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ARENA_DB_PATH: DB,
      ARENA_API_PORT: String(PORT),
      ARENA_API_HOST: "127.0.0.1",
      ARENA_PUBLIC_ORIGIN: BASE,
      ARENA_SECURE_COOKIES: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(log)), 12000);
    const append = (d) => {
      log += d;
      if (log.includes("siap di")) {
        clearTimeout(timer);
        resolve();
      }
    };
    app.stdout.on("data", append);
    app.stderr.on("data", append);
    app.once("error", reject);
    app.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`Server ${code}: ${log}`));
    });
  });
}
async function stop() {
  if (app && app.exitCode == null && app.signalCode == null) {
    const ended = once(app, "exit");
    app.kill();
    await ended;
  }
  app = null;
}
async function api(
  method,
  url,
  data,
  status = method === "POST" ? 201 : 200,
  auth = token,
) {
  const response = await fetch(BASE + url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  assert.equal(response.status, status, text);
  return JSON.parse(text);
}
function inventory() {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return JSON.stringify(
      Object.fromEntries(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'map_route_%' AND name!='sessions' ORDER BY name",
          )
          .all()
          .map(({ name }) => [
            name,
            db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all(),
          ]),
      ),
    );
  } finally {
    db.close();
  }
}
async function context(options = {}) {
  const ctx = await browser.newContext(options);
  ctx.on("page", (page) => {
    page.on("pageerror", (error) => exceptions.push(error.message));
    page.on("request", (req) =>
      requests.push({
        url: req.url(),
        method: req.method(),
        type: req.resourceType(),
      }),
    );
  });
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (isSatelliteTile(url)) {
      tileCalls.push(route.request());
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "cache-control": "no-store" },
        body: SATELLITE_FIXTURE_PNG,
      });
    }
    if (
      url.startsWith(BASE + "/") ||
      url.startsWith("blob:") ||
      url.startsWith("data:")
    )
      return route.continue();
    external++;
    return route.abort();
  });
  return ctx;
}
async function login(page, mail = email, pass = password) {
  await page.goto(BASE + "/login");
  await page.getByLabel("Email", { exact: true }).fill(mail);
  await page.getByLabel("Password", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL(BASE + "/");
}
async function mapReady(page, count) {
  await page.waitForFunction(
    (n) =>
      document.querySelector(".network-map-canvas")?.dataset.routeCount ===
        String(n) &&
      document
        .querySelector(".network-map-canvas")
        ?.getAttribute("aria-busy") === "false",
    count,
  );
}
async function openImport(page) {
  await page
    .getByRole("button", { name: "Impor jalur kabel", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Impor jalur kabel",
    exact: true,
  });
  await dialog.waitFor();
  return dialog;
}
async function choose(dialog, text, name = "jalur-sintetis.xml.csv") {
  await dialog.getByLabel("Berkas jalur kabel", { exact: true }).setInputFiles({
    name,
    mimeType: name.endsWith(".csv")
      ? "text/csv"
      : "application/vnd.google-earth.kml+xml",
    buffer: Buffer.from(text),
  });
}
async function exportFile(page, filtered = false) {
  const promise = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: filtered ? /^Unduh KMZ Terfilter/ : /^Unduh KMZ Lengkap/,
    })
    .click();
  const file = await promise;
  const destination = path.join(artifacts, `export-${Date.now()}.kmz`);
  await file.saveAs(destination);
  const files = unzipSync(fs.readFileSync(destination));
  assert.ok(files["doc.kml"]);
  for (const kind of ["olt", "odc", "odp"])
    assert.ok(files[`icons/${kind}.png`]);
  const raw = strFromU8(files["doc.kml"]);
  const dom = new JSDOM(raw, { contentType: "application/xml" });
  assert.equal(
    dom.window.document.documentElement.namespaceURI,
    "http://www.opengis.net/kml/2.2",
  );
  return { doc: dom.window.document, raw, close: () => dom.window.close() };
}
try {
  console.log(
    "\n=== BROWSER JALUR / IMPOR / WORKER / KMZ (fixture production) ===",
  );
  const bootstrap = spawnSync(
    process.execPath,
    ["scripts/create-admin.mjs", email],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ARENA_DB_PATH: DB,
        FIBEROPS_ADMIN_NAME: "Pemilik fixture jalur",
      },
      input: password,
      encoding: "utf8",
    },
  );
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  await start();
  token = (await api("POST", "/api/login", { email, password }, 200, null))
    .token;
  await api("POST", "/api/users", {
    email: readerEmail,
    password: readerPassword,
    full_name: "Pembaca fixture",
    role: "user",
  });
  await api("POST", "/api/olts", {
    name: "OLT UJI C320",
    olt_type: "ZTE C320",
    location: "Alamat fixture tanpa GPS",
    ip: "192.0.2.8",
  });
  const before = inventory();
  const executablePath = process.env.CHROMIUM_EXECUTABLE || "/usr/bin/chromium";
  const args = JSON.parse(process.env.CHROMIUM_ARGS || "[]").filter(
    (arg) =>
      ![
        "--disable-web-security",
        "--disable-site-isolation-trials",
        "--single-process",
      ].includes(arg),
  );
  browser = await chromium.launch({ executablePath, headless: true, args });
  console.log("Chromium", browser.version(), "; web security aktif.");
  const ctx = await context({ viewport: { width: 1440, height: 1100 } }),
    page = await ctx.newPage();
  debugPage = page;
  page.setDefaultTimeout(12000);
  await login(page);
  await check(
    "dashboard tidak mengambil halaman peta, parser, worker atau geometri jalur",
    async () => {
      await page.goto(BASE + "/dashboard");
      await page
        .getByRole("heading", { name: "Dashboard", exact: true })
        .waitFor();
      assert.equal(
        requests.filter((r) => r.url.includes("/api/route-imports")).length,
        0,
      );
      assert.equal(
        requests.filter((r) =>
          /route-import\.worker|kmz-export\.worker|\/Peta-.*\.js|leaflet-src/.test(
            r.url,
          ),
        ).length,
        0,
      );
    },
  );
  await check(
    "peta satelit tanpa opsi skema, tanpa jalur contoh atau perubahan inventaris",
    async () => {
      await page
        .getByRole("link", { name: "Peta Jaringan / KMZ", exact: true })
        .click();
      await mapReady(page, 0);
      await page
        .locator(".network-map-satellite-tile.leaflet-tile-loaded")
        .first()
        .waitFor();
      assert.ok(tileCalls.length > 0);
      assert.equal(
        await page
          .getByRole("checkbox", { name: /Tampilkan citra satelit Esri/ })
          .isChecked(),
        true,
      );
      assert.equal(
        await page.getByRole("checkbox", { name: /Koneksi skematis/ }).count(),
        0,
      );

      await page
        .getByText("Belum ada jalur kabel tersimpan", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator(".network-map-canvas")
          .getAttribute("data-connection-count"),
        "0",
      );
      assert.equal((await api("GET", "/api/route-imports")).imports.length, 0);
      assert.equal(
        await page
          .getByRole("button", { name: /^Unduh KMZ Lengkap/ })
          .isDisabled(),
        true,
      );
    },
  );
  await check(
    "berkas invalid ditolak di worker, tanpa POST atau jalur parsial",
    async () => {
      const dialog = await openImport(page);
      await choose(dialog, 'Name,Type,Coordinates\na,line,"200,0;201,1"');
      await dialog.getByRole("alert").waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Simpan jalur ke peta" })
          .isDisabled(),
        true,
      );
      assert.equal((await api("GET", "/api/route-imports")).imports.length, 0);
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
    },
  );
  await check(
    "CSV ekstensi ganda: pratinjau 29 segmen/922 vertex sebelum disimpan",
    async () => {
      const dialog = await openImport(page);
      await choose(dialog, csv);
      await dialog
        .getByRole("img", {
          name: "Pratinjau 29 segmen jalur tanpa peta dasar",
        })
        .waitFor();
      assert.equal(await dialog.locator(".route-preview polyline").count(), 29);
      assert.match(await dialog.innerText(), /922/);
      assert.equal((await api("GET", "/api/route-imports")).imports.length, 0);
      await dialog
        .getByLabel("Nama kumpulan jalur", { exact: true })
        .fill("Jalur uji aktif");
    },
  );
  await check(
    "save pending mengunci input/X/Escape/backdrop, submit ganda tidak menggandakan batch",
    async () => {
      let release, done;
      const gate = new Promise((r) => (release = r)),
        finished = new Promise((r) => (done = r));
      let count = 0;
      await page.route(BASE + "/api/route-imports", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        count++;
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
        done();
      });
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: "Simpan jalur ke peta" })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector("[role=dialog]")?.getAttribute("aria-busy") ===
          "true",
      );
      assert.equal(
        await dialog
          .locator("input")
          .evaluateAll((elements) =>
            elements.every((el) => el.matches(":disabled")),
          ),
        true,
      );
      await dialog
        .locator("form")
        .evaluate((form) =>
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
        );
      await page.keyboard.press("Escape");
      await page.locator(".modal-overlay").dispatchEvent("mousedown");
      assert.equal(await dialog.isVisible(), true);
      release();
      await finished;
      await dialog.waitFor({ state: "hidden" });
      await page.unroute(BASE + "/api/route-imports");
      assert.equal(count, 1);
      await mapReady(page, 29);
      assert.equal(inventory(), before);
    },
  );
  await check(
    "jalur benar-benar digambar dengan Canvas, tanpa marker perangkat rekaan",
    async () => {
      await page.waitForFunction(() => {
        const canvas = document.querySelector(
          ".leaflet-cableRoutes-pane canvas",
        );
        if (!canvas) return false;
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let visible = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) visible++;
        return visible > 100;
      });
      assert.equal(
        await page
          .locator(".network-map-canvas")
          .getAttribute("data-marker-count"),
        "0",
      );
      assert.equal(
        await page
          .locator('.network-map-canvas svg path[stroke-dasharray="6 6"]')
          .count(),
        0,
      );
    },
  );
  await check(
    "layar penuh mempertahankan Canvas dan semua jalur tanpa mengambil geometri ulang",
    async () => {
      const surface = await page
        .locator(".leaflet-cableRoutes-pane canvas")
        .elementHandle();
      const requestCount = requests.filter((r) =>
        r.url.includes("/api/"),
      ).length;
      await page
        .getByRole("button", { name: "Peta layar penuh", exact: true })
        .click();
      const full = page.getByRole("dialog", {
        name: "Peta jaringan layar penuh",
        exact: true,
      });
      await full.waitFor();
      await page.waitForFunction(() => {
        const map = document.querySelector(".network-map-canvas"),
          canvas = document.querySelector(".leaflet-cableRoutes-pane canvas");
        if (!map || !canvas || map.clientHeight < innerHeight * 0.8)
          return false;
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let visible = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) visible++;
        return visible > 100;
      });
      assert.equal(
        await surface.evaluate(
          (el) =>
            el === document.querySelector(".leaflet-cableRoutes-pane canvas"),
        ),
        true,
      );
      assert.equal(
        await page
          .locator(".network-map-canvas")
          .getAttribute("data-route-count"),
        "29",
      );
      assert.equal(
        await page
          .locator(".network-map-canvas")
          .getAttribute("data-marker-count"),
        "0",
      );
      assert.equal(
        requests.filter((r) => r.url.includes("/api/")).length,
        requestCount,
      );
      await page.screenshot({
        path: path.join(artifacts, "jalur-layar-penuh.png"),
        fullPage: false,
      });
      await full
        .getByRole("button", { name: "Keluar layar penuh", exact: true })
        .click();
      await full.waitFor({ state: "hidden" });
      assert.equal(
        await surface.evaluate(
          (el) =>
            el === document.querySelector(".leaflet-cableRoutes-pane canvas"),
        ),
        true,
      );
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      assert.equal(inventory(), before);
      await surface.dispose();
    },
  );
  await check(
    "ID segmen membedakan nama sama; nama/description berbahaya hanya teks",
    async () => {
      await page
        .getByText("Telusuri segmen jalur (29 dimuat)", { exact: true })
        .click();
      await page
        .getByRole("button", { name: "Detail segmen #1", exact: true })
        .click();
      const detail = page.locator('[data-selected-route="1"]');
      await detail.waitFor();
      assert.ok((await detail.innerText()).includes(evil));
      assert.equal(await detail.locator("img,script,svg[onload]").count(), 0);
      assert.equal(await page.evaluate(() => window.__routeXss), undefined);
      const geo = await api("GET", "/api/route-imports/1");
      assert.equal(new Set(geo.routes.map((r) => r.id)).size, 29);
      await page.screenshot({
        path: path.join(artifacts, "jalur-desktop.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "KMZ lengkap tetap semua jalur walau layer dimatikan dan titik difilter; unduhan worker nyata",
    async () => {
      await page
        .locator('[data-route-import="1"] input[type=checkbox]')
        .uncheck();
      await mapReady(page, 0);
      await page
        .getByLabel("Jenis perangkat", { exact: true })
        .selectOption("olt");
      const result = await exportFile(page);
      assert.equal(result.doc.querySelectorAll("Point").length, 0);
      assert.equal(result.doc.querySelectorAll("LineString").length, 29);
      const tuples = [
        ...result.doc.querySelectorAll("LineString coordinates"),
      ].flatMap((el) => el.textContent.trim().split(/\s+/));
      assert.equal(tuples.length, 922);
      assert.equal(tuples[0], coordinateRows[0][0].join(",") + ",0");
      assert.ok(result.raw.includes("Jalur kabel impor (29)"));
      assert.ok(!result.raw.includes("192.0.2.8"));
      assert.equal(
        result.doc.querySelectorAll("NetworkLink,script,img").length,
        0,
      );
      result.close();
    },
  );
  await check(
    "KML lokal mempertahankan warna/folder; Point tidak diimpor tanpa persetujuan peringatan",
    async () => {
      const dialog = await openImport(page);
      await choose(dialog, kml, "jalur-kml-uji.kml");
      await dialog
        .getByRole("img", { name: "Pratinjau 1 segmen jalur tanpa peta dasar" })
        .waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Simpan jalur ke peta" })
          .isDisabled(),
        true,
      );
      await dialog.getByRole("checkbox", { name: /Saya memahami/ }).check();
      await dialog
        .getByRole("button", { name: "Simpan jalur ke peta" })
        .click();
      await dialog.waitFor({ state: "hidden" });
      await mapReady(page, 1);
      const index = await api("GET", "/api/route-imports");
      const geo = await api("GET", "/api/route-imports/" + index.imports[1].id);
      assert.equal(geo.routes[0].color, "#112233");
      assert.equal(geo.routes[0].folder, "Area sintetis");
      assert.ok(index.imports[1].warnings.length);
      assert.equal(inventory(), before);
    },
  );
  await check(
    "KMZ terfilter hanya layer dicentang; KMZ lengkap mencakup 30 segmen",
    async () => {
      const filtered = await exportFile(page, true);
      assert.equal(filtered.doc.querySelectorAll("LineString").length, 1);
      assert.equal(filtered.doc.querySelectorAll("Point").length, 0);
      filtered.close();
      const full = await exportFile(page);
      assert.equal(full.doc.querySelectorAll("LineString").length, 30);
      full.close();
    },
  );
  await check(
    "duplikat berkas berbeda nama ditolak 409, pratinjau/input tetap tersedia",
    async () => {
      const dialog = await openImport(page);
      await choose(dialog, csv, "salinan.csv");
      await dialog.getByLabel("Nama kumpulan jalur", { exact: true }).waitFor();
      await dialog
        .getByRole("button", { name: "Simpan jalur ke peta" })
        .click();
      await dialog
        .getByRole("alert")
        .filter({ hasText: /sudah tersimpan/ })
        .waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Tutup", exact: true })
          .isEnabled(),
        true,
      );
      assert.equal((await api("GET", "/api/route-imports")).imports.length, 2);
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
    },
  );
  await check(
    "DOCTYPE/NetworkLink saja dan berkas >3MB ditolak tanpa request eksternal",
    async () => {
      const dialog = await openImport(page);
      await choose(
        dialog,
        '<!DOCTYPE kml SYSTEM "https://private.invalid/private"><kml/>',
        "xxe.kml",
      );
      await dialog.getByRole("alert").waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Simpan jalur ke peta" })
          .isDisabled(),
        true,
      );
      const bytes = zipSync({
        "doc.kml": strToU8(
          "<kml><NetworkLink><Link><href>https://private.invalid/network.kml</href></Link></NetworkLink></kml>",
        ),
      });
      await dialog
        .getByLabel("Berkas jalur kabel", { exact: true })
        .setInputFiles({
          name: "link.kmz",
          mimeType: "application/vnd.google-earth.kmz",
          buffer: Buffer.from(bytes),
        });
      await dialog
        .getByRole("alert")
        .filter({ hasText: /Tidak ada garis/ })
        .waitFor();
      await choose(dialog, "x".repeat(3 * 1024 * 1024 + 1), "besar.csv");
      await dialog.getByRole("alert").filter({ hasText: /3 MB/ }).waitFor();
      assert.equal(external, 0);
      for (const request of tileCalls) assertSatelliteRequest(request);
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
    },
  );
  await check(
    "muat ulang halaman mengambil jalur tersimpan tanpa impor ulang atau worker parser",
    async () => {
      const count = requests.filter((r) =>
        r.url.includes("route-import.worker"),
      ).length;
      await page.reload();
      await mapReady(page, 30);
      assert.equal((await api("GET", "/api/route-imports")).imports.length, 2);
      assert.equal(
        requests.filter((r) => r.url.includes("route-import.worker")).length,
        count,
      );
      assert.equal(inventory(), before);
    },
  );
  await check(
    "pembaca dapat melihat/ekspor, tanpa kontrol impor/hapus; API tetap menolak write",
    async () => {
      const readerCtx = await context(),
        reader = await readerCtx.newPage();
      await login(reader, readerEmail, readerPassword);
      await reader.goto(BASE + "/peta");
      await mapReady(reader, 30);
      assert.equal(
        await reader
          .getByRole("button", { name: "Impor jalur kabel", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await reader.getByRole("button", { name: /Hapus kumpulan/ }).count(),
        0,
      );
      const result = await exportFile(reader);
      assert.equal(result.doc.querySelectorAll("LineString").length, 30);
      result.close();
      const auth = (
        await api(
          "POST",
          "/api/login",
          { email: readerEmail, password: readerPassword },
          200,
          null,
        )
      ).token;
      await api("DELETE", "/api/route-imports/1", undefined, 403, auth);
      await readerCtx.close();
    },
  );
  await check(
    "hapus kumpulan perlu konfirmasi, pending terkunci dan hanya geometri batch terkait hilang",
    async () => {
      await page
        .getByRole("button", {
          name: "Hapus kumpulan Jalur uji aktif",
          exact: true,
        })
        .click();
      let dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Batal", exact: true }).click();
      assert.equal((await api("GET", "/api/route-imports")).imports.length, 2);
      await page
        .getByRole("button", {
          name: "Hapus kumpulan Jalur uji aktif",
          exact: true,
        })
        .click();
      dialog = page.getByRole("dialog");
      let release, done;
      const gate = new Promise((r) => (release = r)),
        finished = new Promise((r) => (done = r));
      await page.route(BASE + "/api/route-imports/1", async (route) => {
        if (route.request().method() !== "DELETE") return route.continue();
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
        done();
      });
      await dialog
        .getByRole("button", { name: "Hapus hanya jalur ini", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector("[role=dialog]")?.getAttribute("aria-busy") ===
          "true",
      );
      await page.keyboard.press("Escape");
      assert.equal(await dialog.isVisible(), true);
      release();
      await finished;
      await dialog.waitFor({ state: "hidden" });
      await page.unroute(BASE + "/api/route-imports/1");
      await mapReady(page, 1);
      assert.equal((await api("GET", "/api/route-imports")).imports.length, 1);
      assert.equal(inventory(), before);
    },
  );
  await check(
    "index gagal tidak dianggap data kosong; ekspor lengkap menunggu pemulihan",
    async () => {
      await page.route(BASE + "/api/route-imports", (route) =>
        route.request().method() === "GET"
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "Index jalur fixture gagal" }),
            })
          : route.continue(),
      );
      await page
        .getByRole("button", { name: "Muat ulang jalur", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Index jalur fixture gagal" })
        .waitFor();
      await mapReady(page, 0);
      assert.equal(
        await page
          .getByRole("button", { name: /^Unduh KMZ Lengkap/ })
          .isDisabled(),
        true,
      );
      await page.unroute(BASE + "/api/route-imports");
      await page
        .getByRole("button", { name: "Muat ulang jalur", exact: true })
        .click();
      await mapReady(page, 1);
    },
  );
  await check(
    "geometri gagal tidak diulang terus atau diekspor setengah; retry memulihkan",
    async () => {
      let count = 0;
      await page.route(BASE + "/api/route-imports/2", (route) => {
        count++;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Geometri fixture gagal" }),
        });
      });
      await page.reload();
      await page
        .getByRole("alert")
        .filter({ hasText: "Geometri fixture gagal" })
        .waitFor();
      await page.waitForTimeout(250);
      assert.equal(count, 1);
      let downloads = 0;
      const observed = () => downloads++;
      page.on("download", observed);
      await page.getByRole("button", { name: /^Unduh KMZ Lengkap/ }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: /Ekspor KMZ gagal/ })
        .waitFor();
      assert.equal(downloads, 0);
      assert.equal(count, 2);
      page.off("download", observed);
      await page.unroute(BASE + "/api/route-imports/2");
      await page
        .getByRole("button", { name: "Muat ulang jalur", exact: true })
        .click();
      await mapReady(page, 1);
    },
  );
  await check(
    "mobile tanpa overflow; modal impor berada di atas Canvas, cancel tidak menyimpan",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      /* Tunggu transisi margin sidebar desktop selesai. */ await page.waitForFunction(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await page.screenshot({
        path: path.join(artifacts, "jalur-mobile.png"),
        fullPage: true,
      });
      const dialog = await openImport(page);
      await choose(dialog, csv);
      await dialog
        .getByRole("img", {
          name: "Pratinjau 29 segmen jalur tanpa peta dasar",
        })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      assert.equal(
        await dialog.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(
            r.x + r.width / 2,
            Math.min(innerHeight - 10, r.y + 30),
          );
          return !!top?.closest("[role=dialog]");
        }),
        true,
      );
      await page.screenshot({
        path: path.join(artifacts, "impor-mobile.png"),
        fullPage: true,
      });
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
      assert.equal((await api("GET", "/api/route-imports")).imports.length, 1);
    },
  );
  await check(
    "KMZ ZIP nyata dibaca worker: MultiGeometry tetap tiga segmen, warna/folder/vertex terjaga",
    async () => {
      const body =
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Folder KMZ sintetis</name><Placemark><name>KMZ UJI</name><Style><LineStyle><color>ffcc8833</color></LineStyle></Style><MultiGeometry>' +
        coordinateRows
          .slice(0, 3)
          .map(
            (points) =>
              "<LineString><coordinates>" +
              points.map((p) => p.join(",")).join(" ") +
              "</coordinates></LineString>",
          )
          .join("") +
        "</MultiGeometry></Placemark></Folder></Document></kml>";
      const bytes = zipSync({
        "doc.kml": strToU8(body),
        "icons/abaikan.txt": strToU8("Aset tidak diunduh/dijalankan"),
      });
      const dialog = await openImport(page);
      await dialog
        .getByLabel("Berkas jalur kabel", { exact: true })
        .setInputFiles({
          name: "uji-lokal.kmz",
          mimeType: "application/vnd.google-earth.kmz",
          buffer: Buffer.from(bytes),
        });
      await dialog
        .getByRole("img", { name: "Pratinjau 3 segmen jalur tanpa peta dasar" })
        .waitFor();
      await dialog
        .getByRole("button", { name: "Simpan jalur ke peta" })
        .click();
      await dialog.waitFor({ state: "hidden" });
      await mapReady(page, 4);
      const index = await api("GET", "/api/route-imports"),
        meta = index.imports.at(-1),
        geo = await api("GET", "/api/route-imports/" + meta.id);
      assert.equal(meta.source_format, "KMZ");
      assert.equal(meta.vertex_count, 96);
      assert.equal(geo.routes.length, 3);
      assert.equal(geo.routes[0].color, "#3388cc");
      assert.equal(geo.routes[0].folder, "Folder KMZ sintetis");
      assert.deepEqual(
        geo.routes.map((r) => r.coordinates.map((p) => p.slice(0, 2))),
        coordinateRows.slice(0, 3),
      );
      assert.equal(inventory(), before);
      await page.screenshot({
        path: path.join(artifacts, "kmz-mobile.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "meninggalkan peta membatalkan worker impor/ekspor yang pending; tidak ada simpan/unduh terlambat",
    async () => {
      const cancelCtx = await context({
        viewport: { width: 1280, height: 900 },
      });
      await cancelCtx.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.__routeWorkers = [];
        window.Worker = class extends NativeWorker {
          constructor(url, options) {
            super(url, options);
            this.kind = String(url).includes("route-import.worker")
              ? "import"
              : String(url).includes("kmz-export.worker")
                ? "export"
                : "other";
            this.record = { kind: this.kind, terminated: false };
            window.__routeWorkers.push(this.record);
          }
          postMessage(...args) {
            if (this.kind === "import" || this.kind === "export") {
              this.record.pending = true;
              return;
            }
            return super.postMessage(...args);
          }
          terminate() {
            this.record.terminated = true;
            return super.terminate();
          }
        };
      });
      const cancelPage = await cancelCtx.newPage();
      await login(cancelPage);
      await cancelPage.goto(BASE + "/dashboard");
      let downloads = 0;
      cancelPage.on("download", () => downloads++);
      await cancelPage
        .getByRole("link", { name: "Peta Jaringan / KMZ", exact: true })
        .click();
      await mapReady(cancelPage, 4);
      const dialog = await openImport(cancelPage);
      await choose(dialog, csv);
      await cancelPage.waitForFunction(() =>
        window.__routeWorkers.some((w) => w.kind === "import" && w.pending),
      );
      assert.equal(
        await dialog
          .getByRole("button", { name: "Simpan jalur ke peta" })
          .isDisabled(),
        true,
      );
      await cancelPage.goBack();
      await cancelPage
        .getByRole("heading", { name: "Dashboard", exact: true })
        .waitFor();
      assert.equal(
        await cancelPage.evaluate(() =>
          window.__routeWorkers
            .filter((w) => w.kind === "import")
            .every((w) => w.terminated),
        ),
        true,
      );
      await cancelPage
        .getByRole("link", { name: "Peta Jaringan / KMZ", exact: true })
        .click();
      await mapReady(cancelPage, 4);
      await cancelPage
        .getByRole("button", { name: /^Unduh KMZ Lengkap/ })
        .click();
      await cancelPage.waitForFunction(() =>
        window.__routeWorkers.some((w) => w.kind === "export" && w.pending),
      );
      await cancelPage.goBack();
      await cancelPage
        .getByRole("heading", { name: "Dashboard", exact: true })
        .waitFor();
      assert.equal(
        await cancelPage.evaluate(() =>
          window.__routeWorkers.every((w) => w.terminated),
        ),
        true,
      );
      assert.equal(downloads, 0);
      assert.equal((await api("GET", "/api/route-imports")).imports.length, 2);
      await cancelCtx.close();
    },
  );
  await check(
    "tidak ada exception JS, token URL, request luar, atau perubahan inventaris/akun",
    async () => {
      assert.deepEqual(exceptions, []);
      assert.equal(external, 0);
      for (const request of tileCalls) assertSatelliteRequest(request);
      assert.ok(
        !requests.some((r) =>
          /[?&](?:token|authorization|session)=/i.test(r.url),
        ),
      );
      assert.equal(inventory(), before);
    },
  );
  console.log(`\nBROWSER JALUR: ${passed} pemeriksaan lulus.`);
} catch (e) {
  if (debugPage)
    await debugPage
      .screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true })
      .catch(() => {});
  console.error("Exception browser:", exceptions);
  throw e;
} finally {
  await browser?.close();
  await stop();
  fs.rmSync(TMP, { recursive: true, force: true });
}
