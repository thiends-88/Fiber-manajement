// Opt-in Chromium nyata: npm run build && CHROMIUM_EXECUTABLE=/path/chromium npm run test:map:browser
// DB baru terisolasi, bootstrap admin privat, build production, web security tetap aktif.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright-core";
import { unzipSync, strFromU8 } from "fflate";
import { JSDOM } from "jsdom";
import { mapLiveFixture } from "./map-live-fixture.mjs";
import {
  SATELLITE_FIXTURE_PNG,
  isSatelliteTile,
  assertSatelliteRequest,
} from "./satellite-tiles.mjs";
const ROOT = path.resolve(import.meta.dirname, ".."),
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-map-browser-")),
  DB = path.join(TMP, "browser.db");
const PORT = Number(process.env.UJI_MAP_BROWSER_PORT || 4908),
  BASE = `http://127.0.0.1:${PORT}`;
const artifacts =
  process.env.MAP_BROWSER_ARTIFACTS || path.join(TMP, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const email = "owner-map@browser.test",
  password = "PrivateBrowserMap123!",
  readerEmail = "reader-map@browser.test",
  readerPassword = "ReaderBrowserMap123!";
let app,
  browser,
  token,
  debugPage,
  releaseGate,
  passed = 0,
  tileRequests = 0,
  failSatelliteTiles = false,
  failAboveZoom = null;
const exceptions = [],
  requests = [],
  downloads = [],
  tileCalls = [],
  externalRequests = [];
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
    const timer = setTimeout(() => reject(Error(log)), 15000);
    const append = (d) => {
      log += d;
      if (log.includes("siap di")) {
        clearTimeout(timer);
        resolve();
      }
    };
    app.stdout.on("data", append);
    app.stderr.on("data", append);
    app.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    app.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`Server ${code}: ${log}`));
    });
  });
}
async function stop() {
  if (app && app.exitCode == null && app.signalCode == null) {
    const done = once(app, "exit");
    app.kill();
    await done;
  }
  app = null;
}
async function request(
  method,
  route,
  body,
  status = method === "POST" ? 201 : 200,
) {
  const response = await fetch(BASE + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${route}: ${JSON.stringify(data)}`,
  );
  return data;
}
async function context(options = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    ...options,
  });
  ctx.setDefaultTimeout(10000);
  ctx.on("page", (page) => {
    page.on("pageerror", (e) => exceptions.push(e.message));
    page.on("request", (req) => {
      if (req.url().startsWith(BASE + "/api/")) requests.push(req);
    });
    page.on("download", (file) => downloads.push(file));
  });
  await ctx.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (isSatelliteTile(url.href)) {
      tileRequests++;
      tileCalls.push(route.request());
      if (failSatelliteTiles) return route.abort("internetdisconnected");
      const z = Number(url.pathname.split("/").at(-3));
      if (failAboveZoom !== null && z > failAboveZoom)
        return route.fulfill({
          status: 404,
          body: "Tile tidak tersedia (fixture)",
        });
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "cache-control": "no-store" },
        body: SATELLITE_FIXTURE_PNG,
      });
    }
    if (
      url.hostname !== "127.0.0.1" &&
      !["blob:", "data:"].includes(url.protocol)
    ) {
      externalRequests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  return ctx;
}
async function zoomMaximum(page) {
  const zoom = page.locator(".leaflet-control-zoom-in");
  for (let step = 0; step < 22; step++) {
    if ((await zoom.getAttribute("aria-disabled")) === "true") break;
    await zoom.click();
  }
  await page.waitForFunction(
    () =>
      document.querySelector(".network-map-canvas")?.dataset.mapZoom === "22",
  );
  assert.equal(await zoom.getAttribute("aria-disabled"), "true");
}
async function loginPage(page, who = email, secret = password) {
  await page.goto(BASE + "/login");
  await page.getByLabel("Email", { exact: true }).fill(who);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL(BASE + "/");
  await page
    .getByRole("heading", { name: "Alur Core OLT → ODC → ODP", exact: true })
    .waitFor();
}
async function mapReady(page, points) {
  await page
    .locator(
      `.network-map-canvas[aria-busy="false"][data-marker-count="${points}"]`,
    )
    .waitFor({ timeout: 15000 });
}
async function toMap(page, points) {
  await page.goto(BASE + "/peta");
  await mapReady(page, points);
}
async function fullMap(page, points) {
  await page
    .getByRole("button", { name: "Tampilkan Semua Titik", exact: true })
    .click();
  await mapReady(page, points);
}
async function selectList(page, kind, id) {
  const summary = page.getByText(/^Daftar titik valid \(\d+\)$/, {
    exact: true,
  });
  if ((await summary.locator("..").getAttribute("open")) === null)
    await summary.click();
  await page
    .getByRole("button", { name: `Detail ${kind} #${id}`, exact: true })
    .click();
  await page
    .locator(`[data-selected-device="${kind.toLowerCase()}-${id}"]`)
    .waitFor();
}
function parseKmz(bytes) {
  const files = unzipSync(bytes);
  assert.deepEqual(Object.keys(files).sort(), [
    "doc.kml",
    "icons/odc.png",
    "icons/odp.png",
    "icons/olt.png",
  ]);
  for (const kind of ["olt", "odc", "odp"])
    assert.deepEqual(
      [...files[`icons/${kind}.png`].subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
  const raw = strFromU8(files["doc.kml"]),
    dom = new JSDOM(raw, { contentType: "text/xml" });
  return { files, raw, dom, doc: dom.window.document };
}
async function download(page, name, saveName) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name }).click();
  const file = await event;
  assert.equal(await file.failure(), null);
  assert.match(file.suggestedFilename(), /\.kmz$/);
  const bytes = fs.readFileSync(await file.path());
  if (saveName) fs.writeFileSync(path.join(artifacts, saveName), bytes);
  return { ...parseKmz(bytes), filename: file.suggestedFilename() };
}
async function openGps(page, kind, id) {
  const control = page.getByRole("button", {
    name: `Atur koordinat ${kind} #${id}`,
    exact: true,
    includeHidden: true,
  });
  if (!(await control.isVisible())) {
    const summary = page.getByText(/^Daftar titik valid \(\d+\)$/, {
      exact: true,
    });
    if ((await summary.locator("..").getAttribute("open")) === null)
      await summary.click();
  }
  await control.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  return dialog;
}
async function heldGps(page, dialog, route, failure = false) {
  let arrived;
  const seen = new Promise((resolve) => {
      arrived = resolve;
    }),
    gate = new Promise((resolve) => {
      releaseGate = resolve;
    });
  let count = 0;
  await page.route(BASE + route, async (intercepted) => {
    if (intercepted.request().method() !== "PATCH")
      return intercepted.continue();
    count++;
    arrived();
    await gate;
    if (failure)
      return intercepted.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Simulasi GPS gagal" }),
      });
    return intercepted.continue();
  });
  await dialog.getByRole("button", { name: "Simpan GPS", exact: true }).click();
  await seen;
  assert.equal(await dialog.getAttribute("aria-busy"), "true");
  for (const control of await dialog
    .locator("input,select,textarea,button")
    .all())
    assert.ok(await control.isDisabled());
  await dialog.locator("form").evaluate((form) => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await page.keyboard.press("Escape");
  await page.mouse.click(2, 2);
  assert.ok(await dialog.isVisible());
  assert.equal(count, 1);
  const box = await dialog.boundingBox();
  assert.ok(
    await page.evaluate(
      ({ x, y }) =>
        !!document.elementFromPoint(x, y)?.closest(".modal-overlay"),
      { x: box.x + 20, y: box.y + 20 },
    ),
  );
  releaseGate();
  releaseGate = null;
  if (failure) {
    await page
      .getByRole("alert")
      .filter({ hasText: "Simulasi GPS gagal" })
      .waitFor();
    assert.ok(await dialog.isVisible());
    assert.ok(
      await dialog
        .getByRole("button", { name: "Tutup", exact: true })
        .isEnabled(),
    );
  } else await dialog.waitFor({ state: "hidden" });
  await page.unroute(BASE + route);
}
try {
  console.log(
    "\n=== BROWSER PETA / KMZ / GPS (production, fixture sementara) ===",
  );
  const bootstrap = spawnSync(
    process.execPath,
    ["scripts/create-admin.mjs", email],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ARENA_DB_PATH: DB,
        FIBEROPS_ADMIN_NAME: "Pemilik fixture browser peta",
      },
      input: password,
      encoding: "utf8",
    },
  );
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  await start();
  token = (await request("POST", "/api/login", { email, password }, 200)).token;
  await request("POST", "/api/users", {
    email: readerEmail,
    password: readerPassword,
    full_name: "Pembaca fixture",
    role: "user",
  });
  const f = await mapLiveFixture(request);
  const executablePath =
    process.env.CHROMIUM_EXECUTABLE ||
    [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome",
    ].find((file) => fs.existsSync(file));
  if (!executablePath)
    throw Error(
      "Set CHROMIUM_EXECUTABLE ke browser lokal; pengujian tidak mengunduh browser otomatis.",
    );
  const args = JSON.parse(process.env.CHROMIUM_ARGS || "[]").filter(
    (arg) =>
      ![
        "--disable-web-security",
        "--allow-running-insecure-content",
        "--disable-site-isolation-trials",
        "--single-process",
      ].includes(arg) &&
      !arg.startsWith("--disable-features=") &&
      !arg.startsWith("--enable-features="),
  );
  browser = await chromium.launch({ executablePath, headless: true, args });
  console.log(`Chromium ${browser.version()}; web security aktif.`);
  const desktop = await context(),
    page = await desktop.newPage();
  debugPage = page;
  await check(
    "/peta tanpa sesi dialihkan ke login dan snapshot tidak dibocorkan",
    async () => {
      await page.goto(BASE + "/peta");
      await page.waitForURL(BASE + "/login");
      assert.equal(await page.locator(".network-map-canvas").count(), 0);
    },
  );
  await loginPage(page);
  await check(
    "menu tunggal membuka seluruh GPS/satelit, tanpa menawarkan koneksi skematis",
    async () => {
      assert.equal(tileRequests, 0, "Tile tidak dimuat sebelum Peta dibuka");
      await page
        .getByRole("link", { name: "Peta Jaringan / KMZ", exact: true })
        .click();
      await mapReady(page, 11);
      await page
        .locator(".network-map-satellite-tile.leaflet-tile-loaded")
        .first()
        .waitFor();
      assert.ok(tileRequests > 0);
      assert.equal(
        await page
          .getByRole("checkbox", { name: /Tampilkan citra satelit Esri/ })
          .isChecked(),
        true,
      );
      assert.match(
        await page.locator("[data-map-summary]").innerText(),
        /11 titik valid · 3 belum ada koordinat · 0 segmen jalur/,
      );
      assert.equal(
        await page.getByRole("checkbox", { name: /Koneksi skematis/ }).count(),
        0,
      );
      assert.equal(
        await page
          .locator(".network-map-canvas")
          .getAttribute("data-connection-count"),
        "0",
      );
      assert.equal(
        await page
          .locator('.network-map-canvas svg path[stroke-dasharray="6 6"]')
          .count(),
        0,
      );
      assert.match(
        await page.locator(".leaflet-control-attribution").innerText(),
        /Esri.*Maxar.*Earthstar/,
      );
      assert.equal(
        await page
          .locator(".leaflet-control-attribution")
          .evaluate((credit) => {
            const panel = document.createElement("span");
            panel.style.backgroundColor = "var(--color-panel)";
            credit.append(panel);
            const expected = getComputedStyle(panel).backgroundColor;
            panel.remove();
            return getComputedStyle(credit).backgroundColor === expected;
          }),
        true,
        "Kredit citra mengikuti tema, bukan tertimpa CSS Leaflet lazy",
      );
    },
  );
  await check(
    "cluster menghitung semua perangkat, termasuk tiga ID berbeda berkoordinat sama",
    async () => {
      const total = await page
        .locator(".network-map-canvas")
        .evaluate(
          (el) =>
            [...el.querySelectorAll(".network-map-cluster")].reduce(
              (sum, node) => sum + parseInt(node.textContent, 10),
              0,
            ) + el.querySelectorAll(".network-map-marker").length,
        );
      assert.equal(total, 11);
      assert.ok(
        await page
          .locator(".network-map-cluster")
          .first()
          .evaluate((node) => {
            const outer = node.getBoundingClientRect(),
              label = node.firstElementChild.getBoundingClientRect();
            return (
              getComputedStyle(node).display === "grid" &&
              Math.abs(label.x + label.width / 2 - outer.x - outer.width / 2) <
                2
            );
          }),
      );
      await selectList(page, "OLT", f.A.id);
      for (const title of [
        `OLT · ${f.A.name}`,
        `ODC · ${f.R.name}`,
        `ODP · ${f.Q1.name}`,
      ])
        await page.getByTitle(title, { exact: true }).waitFor();
      assert.ok(await page.locator(".leaflet-popup-content").isVisible());
    },
  );
  await check(
    "popup dan detail menampilkan nama/alamat XSS sebagai teks, bukan markup",
    async () => {
      await selectList(page, "ODP", f.Q2.id);
      await page
        .locator(".leaflet-popup-content")
        .filter({ hasText: f.Q2.name })
        .waitFor();
      assert.equal(
        await page
          .locator(
            '.network-map-popup img[src="x"], .network-map-popup svg[onload], [data-selected-device] script, [data-selected-device] img[src="x"]',
          )
          .count(),
        0,
      );
      assert.equal(await page.evaluate(() => window.__mapXss), undefined);
      const popupText = await page
        .locator(".leaflet-popup-content")
        .filter({ hasText: f.Q2.name })
        .innerText();
      assert.ok(popupText.includes(f.Q2.name));
      assert.doesNotMatch(popupText, /(?:OLT|ODC|ODP) #\d+/);
      assert.equal(
        (
          await page.locator("[data-selected-device] p").first().innerText()
        ).trim(),
        "ODP",
      );
    },
  );
  await check(
    "peta layar penuh menutup navigasi; pusat/zoom/marker tetap, tanpa fetch ulang",
    async () => {
      const canvas = await page.locator(".network-map-canvas").elementHandle();
      const mapId = await canvas.evaluate((el) => el._leaflet_id);
      const marker = page.getByTitle(`ODP · ${f.Q2.name}`, { exact: true });
      await marker.waitFor();
      await page.locator(".leaflet-control-zoom-out").click();
      const rect = await page.locator(".network-map-canvas").boundingBox();
      await page.mouse.move(
        rect.x + rect.width * 0.75,
        rect.y + rect.height * 0.75,
      );
      await page.mouse.down();
      await page.mouse.move(
        rect.x + rect.width * 0.75 + 45,
        rect.y + rect.height * 0.75 + 25,
        { steps: 6 },
      );
      await page.mouse.up();
      // Leaflet menyelesaikan pan inertia setelah mouseup; ukur view yang stabil.
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.waitForFunction(
        () =>
          !document
            .querySelector(".leaflet-map-pane")
            ?.classList.contains("leaflet-pan-anim"),
      );
      const offset = () =>
        marker.evaluate((el) => {
          const m = document
              .querySelector(".network-map-canvas")
              .getBoundingClientRect(),
            r = el.getBoundingClientRect();
          return [
            r.x + r.width / 2 - m.x - m.width / 2,
            r.y + r.height / 2 - m.y - m.height / 2,
          ];
        });
      const before = await offset(),
        apiCount = requests.length;
      const waitForSameCenter = () =>
        page.waitForFunction(
          ({ title, before }) => {
            const point = [
              ...document.querySelectorAll(".leaflet-marker-icon"),
            ].find((el) => el.title === title);
            const canvas = document.querySelector(".network-map-canvas");
            if (!point || !canvas) return false;
            const r = point.getBoundingClientRect(),
              m = canvas.getBoundingClientRect();
            return (
              Math.abs(r.x + r.width / 2 - m.x - m.width / 2 - before[0]) < 2 &&
              Math.abs(r.y + r.height / 2 - m.y - m.height / 2 - before[1]) < 2
            );
          },
          { title: `ODP · ${f.Q2.name}`, before },
        );

      await page
        .getByRole("button", { name: "Peta layar penuh", exact: true })
        .click();
      const full = page.getByRole("dialog", {
        name: "Peta jaringan layar penuh",
        exact: true,
      });
      await full.waitFor();
      await page.waitForFunction(() => {
        const e = document.querySelector(".network-map-canvas"),
          shell = document.querySelector(".network-map-fullpage");
        return (
          e &&
          shell &&
          e.clientHeight > innerHeight * 0.8 &&
          shell.getBoundingClientRect().width === innerWidth
        );
      });
      const box = await full.boundingBox();
      assert.ok(
        Math.abs(box.x) < 1 &&
          Math.abs(box.y) < 1 &&
          Math.abs(box.width - 1440) < 1 &&
          Math.abs(box.height - 1000) < 1,
      );
      assert.equal(await full.getAttribute("aria-modal"), "true");
      assert.equal(
        await page.evaluate(() => document.body.style.overflow),
        "hidden",
      );
      assert.equal(
        await page.evaluate(
          () =>
            !!document
              .elementFromPoint(15, 15)
              ?.closest(".network-map-fullpage"),
        ),
        true,
      );
      assert.equal(
        await canvas.evaluate(
          (el) =>
            el === document.querySelector(".network-map-canvas") &&
            el._leaflet_id,
        ),
        mapId,
      );
      await waitForSameCenter();
      const after = await offset();
      assert.ok(
        Math.abs(after[0] - before[0]) < 2 &&
          Math.abs(after[1] - before[1]) < 2,
        `Pusat berubah ${before} => ${after}`,
      );
      assert.equal(requests.length, apiCount);
      await page.screenshot({
        path: path.join(artifacts, "peta-layar-penuh.png"),
        fullPage: false,
      });
      await page.keyboard.press("Escape");
      await full.waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          document.querySelector(".network-map-canvas")?.clientHeight <
          innerHeight * 0.8,
      );
      await waitForSameCenter();
      const restored = await offset();
      assert.ok(
        Math.abs(restored[0] - before[0]) < 2 &&
          Math.abs(restored[1] - before[1]) < 2,
      );
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      assert.equal(
        await page
          .getByRole("button", { name: "Peta layar penuh", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await canvas.dispose();
    },
  );
  await check(
    "popup perangkat tetap terbaca tanpa ID internal; Lihat detail keluar dari layar penuh",
    async () => {
      await page
        .getByRole("button", { name: "Peta layar penuh", exact: true })
        .click();
      await page.getByTitle(`ODP · ${f.Q2.name}`, { exact: true }).click();
      const popup = page
        .locator(".leaflet-popup-content")
        .filter({ hasText: f.Q2.name });
      await popup.waitFor();
      assert.doesNotMatch(await popup.innerText(), /(?:OLT|ODC|ODP) #\d+/);
      assert.ok((await popup.boundingBox()).width >= 180);
      await popup
        .getByRole("button", { name: "Lihat detail", exact: true })
        .click();
      await page.locator(".network-map-fullpage").waitFor({ state: "hidden" });
      await page.locator(`[data-selected-device="odp-${f.Q2.id}"]`).waitFor();
    },
  );
  await check(
    "filter induk adalah inventaris, pencarian kosong tidak menambah titik default",
    async () => {
      await page
        .getByLabel("OLT induk inventaris", { exact: true })
        .selectOption(String(f.B.id));
      await mapReady(page, 2);
      assert.match(
        await page.locator("[data-map-summary]").innerText(),
        /2 titik valid/,
      );
      await page
        .getByRole("textbox", {
          name: "Cari nama, lokasi, atau induk…",
          exact: true,
        })
        .fill("tidak-ada-xyz");
      await mapReady(page, 0);
      assert.ok(
        await page
          .getByText(
            "Belum ada titik perangkat atau jalur impor pada tampilan ini.",
            {
              exact: true,
            },
          )
          .isVisible(),
      );
      assert.ok(
        await page
          .getByRole("button", {
            name: "Unduh KMZ Lengkap (11 titik)",
            exact: true,
          })
          .isEnabled(),
      );
      await fullMap(page, 11);
      assert.equal(
        await page
          .getByLabel("OLT induk inventaris", { exact: true })
          .inputValue(),
        "",
      );
    },
  );
  await check(
    "KMZ lengkap tetap 11 titik walau difilter; ikon lokal/WGS84 tanpa geometri hubungan",
    async () => {
      await page
        .getByLabel("Jenis perangkat", { exact: true })
        .selectOption("odp");
      await mapReady(page, 3);
      const kmz = await download(
        page,
        "Unduh KMZ Lengkap (11 titik)",
        "fixture-lengkap.kmz",
      );
      assert.match(kmz.filename, /peta-jaringan-lengkap-/);
      assert.equal(kmz.doc.querySelectorAll("Point").length, 11);
      assert.equal(kmz.doc.querySelectorAll("LineString").length, 0);
      for (const [kind, id] of [
        ["olt", f.A.id],
        ["odc", f.R.id],
        ["odp", f.Q1.id],
      ])
        assert.equal(
          kmz.doc.querySelector(`[id="point-${kind}-${id}"] Point coordinates`)
            .textContent,
          "100.64,-0.79,0",
        );
      assert.equal(
        kmz.doc.querySelectorAll(
          '[id^="connection-"], Style[id="connection"], Style[id="review"]',
        ).length,
        0,
      );
      assert.ok(
        !kmz.raw.includes(">schematic<") &&
          !kmz.raw.includes("Koneksi skematis"),
      );
      assert.ok(!kmz.raw.includes("192.0.2.45"));
      assert.ok(!kmz.raw.includes(email));
      assert.ok(!kmz.raw.includes("/api/"));
      assert.ok(kmz.raw.includes("bukan bukti sambungan port/core"));
      assert.equal(
        kmz.doc.querySelectorAll("NetworkLink, script, img").length,
        0,
      );
      kmz.dom.window.close();
    },
  );
  await check(
    "KMZ terfilter berisi tiga ODP tanpa garis hubungan downstream",
    async () => {
      const kmz = await download(
        page,
        "Unduh KMZ Terfilter (3 titik)",
        "fixture-terfilter.kmz",
      );
      assert.match(kmz.filename, /peta-jaringan-terfilter-/);
      assert.equal(kmz.doc.querySelectorAll("Point").length, 3);
      assert.equal(kmz.doc.querySelectorAll("LineString").length, 0);
      assert.ok(
        [...kmz.doc.querySelectorAll("Placemark[id^='point-']")].every((p) =>
          p.id.startsWith("point-odp-"),
        ),
      );
      kmz.dom.window.close();
    },
  );
  await check(
    "satelit mati menghentikan tile; KMZ tetap GPS tanpa citra atau skema",
    async () => {
      const toggle = page.getByRole("checkbox", {
        name: /Tampilkan citra satelit Esri/,
      });
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".leaflet-tile img")].every(
          (image) => image.complete,
        ),
      );
      await toggle.uncheck();
      await page.waitForFunction(
        () => !document.querySelector(".leaflet-tile-pane img"),
      );
      const count = tileRequests;
      await page.locator(".leaflet-control-zoom-in").click();
      const kmz = await download(page, "Unduh KMZ Terfilter (3 titik)");
      assert.equal(kmz.doc.querySelectorAll("Point").length, 3);
      assert.equal(
        kmz.doc.querySelectorAll("LineString, GroundOverlay, NetworkLink")
          .length,
        0,
      );
      assert.ok(
        !kmz.raw.includes("arcgisonline.com") &&
          !kmz.raw.includes("openstreetmap.org"),
      );
      kmz.dom.window.close();
      assert.equal(tileRequests, count);
      await toggle.check();
      await fullMap(page, 11);
    },
  );
  await check(
    "ikon export gagal tidak menghasilkan KMZ rusak; kontrol pulih dan retry berhasil",
    async () => {
      await page.route("**/assets/olt-*.png", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html>Fallback SPA",
        }),
      );
      const count = downloads.length;
      await page
        .getByRole("button", {
          name: "Unduh KMZ Lengkap (11 titik)",
          exact: true,
        })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: /Ekspor KMZ gagal/ })
        .waitFor();
      assert.equal(downloads.length, count);
      assert.ok(
        await page
          .getByRole("button", {
            name: "Unduh KMZ Lengkap (11 titik)",
            exact: true,
          })
          .isEnabled(),
      );
      await page.unroute("**/assets/olt-*.png");
      const kmz = await download(page, "Unduh KMZ Lengkap (11 titik)");
      assert.equal(kmz.doc.querySelectorAll("Point").length, 11);
      kmz.dom.window.close();
    },
  );
  await check(
    "tile gagal setelah fallback terbatas tidak mematikan detail/KMZ; toggle memulihkan",
    async () => {
      const toggle = page.getByRole("checkbox", {
        name: /Tampilkan citra satelit Esri/,
      });
      await toggle.uncheck();
      await page.waitForFunction(
        () => !document.querySelector(".leaflet-tile-pane img"),
      );
      await page
        .locator(".leaflet-control-zoom-out")
        .click({ modifiers: ["Shift"] });
      failSatelliteTiles = true;
      const before = tileRequests;
      await toggle.check();
      await page
        .getByText(
          "Sebagian citra satelit gagal dimuat. Titik, jalur impor, detail, dan KMZ tetap tersedia.",
          { exact: true },
        )
        .waitFor();
      assert.ok(tileRequests > before);
      await mapReady(page, 11);
      await selectList(page, "ODC", f.C.id);
      const kmz = await download(page, "Unduh KMZ Lengkap (11 titik)");
      assert.equal(kmz.doc.querySelectorAll("Point").length, 11);
      assert.equal(kmz.doc.querySelectorAll("LineString").length, 0);
      kmz.dom.window.close();
      await toggle.uncheck();
      failSatelliteTiles = false;
      await toggle.check();
      await page
        .locator(".network-map-satellite-tile.leaflet-tile-loaded")
        .first()
        .waitFor();
      assert.equal(
        await page.getByText(/Sebagian citra satelit gagal dimuat/).count(),
        0,
      );
    },
  );
  await check(
    "zoom sampai 22 memakai citra <=19, skala lebih dekat dari 20m, dan layar penuh tetap stabil",
    async () => {
      const before = requests.filter((r) => r.method() !== "GET").length;
      await zoomMaximum(page);
      const scale = await page
        .locator(".leaflet-control-scale-line")
        .innerText();
      assert.match(scale, /^\d+(?:\.\d+)? m$/);
      assert.ok(parseFloat(scale) <= 10, scale);
      await page
        .getByText(
          "Citra diperbesar dari resolusi yang tersedia; zoom lebih dekat tidak menambah ketajaman atau akurasi GPS.",
          { exact: true },
        )
        .waitFor();
      await page
        .getByRole("button", { name: "Peta layar penuh", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Peta jaringan layar penuh", exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".network-map-canvas").getAttribute("data-map-zoom"),
        "22",
      );
      await page.keyboard.press("Escape");
      await page.locator(".network-map-fullpage").waitFor({ state: "hidden" });
      assert.equal(
        await page.locator(".network-map-canvas").getAttribute("data-map-zoom"),
        "22",
      );
      assert.equal(requests.filter((r) => r.method() !== "GET").length, before);
      await fullMap(page, 11);
    },
  );
  await check(
    "tile native 19/18 tidak tersedia: induk 17 dipotong benar tanpa menurunkan zoom atau GPS",
    async () => {
      const snapshot = await request("GET", "/api/map-data");
      failAboveZoom = 17;
      const ctx = await context(),
        fallback = await ctx.newPage();
      debugPage = fallback;
      await loginPage(fallback);
      await toMap(fallback, 11);
      await zoomMaximum(fallback);
      const loaded = fallback
        .locator(
          '.network-map-satellite-tile[data-satellite-requested-zoom="19"][data-satellite-source-zoom="17"].leaflet-tile-loaded',
        )
        .first();
      await loaded.waitFor();
      const image = loaded.locator("img");
      assert.match(
        await image.getAttribute("src"),
        /tile\/17\/\d+\/\d+\?blankTile=false$/,
      );
      assert.equal(await image.evaluate((el) => el.style.width), "1024px");
      assert.equal(
        await fallback
          .locator(".network-map-canvas")
          .getAttribute("data-map-zoom"),
        "22",
      );
      assert.equal(
        await fallback.getByText(/Sebagian citra satelit gagal dimuat/).count(),
        0,
      );
      const after = await request("GET", "/api/map-data");
      for (const key of [
        "olts",
        "odcs",
        "odps",
        "interfaceMappings",
        "links",
        "splitters",
      ])
        assert.deepEqual(after[key], snapshot[key]);
      await ctx.close();
      failAboveZoom = null;
      debugPage = page;
    },
  );
  await check(
    "GPS-only pending mengunci modal; setelah sukses perangkat missing masuk peta tanpa mengubah alamat/induk",
    async () => {
      const dialog = await openGps(page, "ODP", f.Q4.id);
      await dialog
        .getByLabel("Sumber koordinat peta", { exact: true })
        .selectOption("manual");
      await dialog
        .getByLabel("Latitude (lintang)", { exact: true })
        .fill("-0,84");
      await dialog
        .getByLabel("Longitude (bujur)", { exact: true })
        .fill("100,75");
      await heldGps(page, dialog, `/api/odps/${f.Q4.id}`);
      await mapReady(page, 12);
      const row = (await request("GET", "/api/odps")).find(
        (r) => r.id === f.Q4.id,
      );
      assert.equal(row.location, f.Q4.location);
      assert.equal(row.odc_id, f.Q4.odc_id);
      assert.equal(row.latitude, -0.84);
      assert.equal(row.longitude, 100.75);
      const write = requests.findLast(
        (r) =>
          r.method() === "PATCH" && r.url().endsWith(`/api/odps/${f.Q4.id}`),
      );
      assert.deepEqual(Object.keys(JSON.parse(write.postData())).sort(), [
        "coordinate_mode",
        "latitude",
        "longitude",
      ]);
    },
  );
  await check(
    "GPS save gagal membuka kembali kontrol, mempertahankan input, dan retry memperbarui snapshot",
    async () => {
      const dialog = await openGps(page, "ODP", f.Q4.id);
      await dialog
        .getByLabel("Latitude (lintang)", { exact: true })
        .fill("-0.841");
      await heldGps(page, dialog, `/api/odps/${f.Q4.id}`, true);
      assert.equal(
        await dialog
          .getByLabel("Latitude (lintang)", { exact: true })
          .inputValue(),
        "-0.841",
      );
      await dialog
        .getByRole("button", { name: "Simpan GPS", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      await mapReady(page, 12);
      assert.equal(
        (await request("GET", "/api/odps")).find((r) => r.id === f.Q4.id)
          .latitude,
        -0.841,
      );
    },
  );
  await check(
    "clear GPS eksplisit tidak menghapus Lokasi dan tidak muncul lagi setelah reload/KMZ",
    async () => {
      await selectList(page, "ODP", f.Q1.id);
      await page
        .locator("[data-selected-device]")
        .getByRole("button", { name: "Atur GPS", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Sumber koordinat peta", { exact: true })
        .selectOption("none");
      await dialog
        .getByRole("button", { name: "Simpan GPS", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      await mapReady(page, 11);
      await page.reload();
      await mapReady(page, 11);
      const row = (await request("GET", "/api/odps")).find(
        (r) => r.id === f.Q1.id,
      );
      assert.equal(row.coordinate_mode, "none");
      assert.equal(row.location, f.Q1.location);
      const kmz = await download(page, "Unduh KMZ Lengkap (11 titik)");
      assert.ok(!kmz.doc.querySelector(`[id="point-odp-${f.Q1.id}"]`));
      kmz.dom.window.close();
    },
  );
  await check(
    "form OLT C320 mempertahankan alamat lama sambil mengisi GPS terpisah",
    async () => {
      await page.goto(BASE + "/olt");
      await page.getByTitle(`Edit OLT ${f.B.name}`, { exact: true }).click();
      const dialog = page.getByRole("dialog");
      assert.equal(
        await dialog
          .getByLabel("Sumber koordinat peta", { exact: true })
          .inputValue(),
        "location",
      );
      await dialog
        .getByLabel("Sumber koordinat peta", { exact: true })
        .selectOption("manual");
      assert.equal(
        await dialog
          .getByLabel("Latitude (lintang)", { exact: true })
          .inputValue(),
        "-0.8",
      );
      await dialog
        .getByLabel("Latitude (lintang)", { exact: true })
        .fill("-0.801");
      await dialog
        .getByLabel("Longitude (bujur)", { exact: true })
        .fill("100.651");
      await dialog.getByRole("button", { name: "Simpan", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const row = (await request("GET", "/api/olts")).find(
        (r) => r.id === f.B.id,
      );
      assert.equal(row.location, f.B.location);
      assert.equal(row.olt_type, "ZTE C320");
      assert.equal(row.latitude, -0.801);
    },
  );
  await check(
    "form ODC query edit memuat GPS dan tidak mengubah receiver/sambungan",
    async () => {
      const before = await request("GET", "/api/splitters");
      await page.goto(BASE + `/odc?odc=${f.C.id}&edit=1`);
      const dialog = page.getByRole("dialog", {
        name: "Edit ODC",
        exact: true,
      });
      await dialog.waitFor();
      assert.equal(
        await dialog
          .getByLabel("Latitude (lintang)", { exact: true })
          .inputValue(),
        "-0.81",
      );
      await dialog
        .getByLabel("Latitude (lintang)", { exact: true })
        .fill("-0.811");
      await dialog.getByRole("button", { name: "Simpan", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.deepEqual(await request("GET", "/api/splitters"), before);
    },
  );
  await check(
    "tautan ODP memilih perangkat tepat, form GPS tetap mempertahankan splitter 1:8",
    async () => {
      await page.goto(BASE + `/odp?odp=${f.Q3.id}`);
      await page
        .getByRole("heading", {
          name: `Asal interface OLT — ${f.Q3.name}`,
          exact: true,
        })
        .waitFor();
      await page.getByTitle(`Edit ODP ${f.Q3.name}`, { exact: true }).click();
      const dialog = page.getByRole("dialog");
      assert.equal(
        await dialog
          .getByLabel("Latitude (lintang)", { exact: true })
          .inputValue(),
        "-0.84",
      );
      await dialog
        .getByLabel("Latitude (lintang)", { exact: true })
        .fill("-0.842");
      await dialog.getByRole("button", { name: "Simpan", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const splitters = await request(
        "GET",
        `/api/splitters?odp_id=${f.Q3.id}`,
      );
      assert.equal(splitters[0].ratio, "1:8");
      assert.equal(splitters[0].outputs.length, 8);
    },
  );
  await check(
    "mode Lokasi pada form ODP dapat mengembalikan titik lama tanpa menulis ulang teks",
    async () => {
      await page.goto(BASE + `/odp?odp=${f.Q1.id}`);
      await page.getByTitle(`Edit ODP ${f.Q1.name}`, { exact: true }).click();
      const dialog = page.getByRole("dialog");
      assert.equal(
        await dialog
          .getByLabel("Sumber koordinat peta", { exact: true })
          .inputValue(),
        "none",
      );
      await dialog
        .getByLabel("Sumber koordinat peta", { exact: true })
        .selectOption("location");
      await dialog.getByRole("button", { name: "Simpan", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await toMap(page, 12);
    },
  );
  await check(
    "snapshot gagal tidak meninggalkan ekspor stale; retry memulihkan peta",
    async () => {
      await page.route(BASE + "/api/map-data", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Snapshot peta fixture gagal" }),
        }),
      );
      await page
        .getByRole("button", { name: "Muat ulang peta", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Snapshot peta fixture gagal" })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: /Unduh KMZ Lengkap/ }).count(),
        0,
      );
      assert.equal(await page.locator(".network-map-canvas").count(), 0);
      await page.unroute(BASE + "/api/map-data");
      await page
        .getByRole("button", { name: "Coba lagi", exact: true })
        .click();
      await mapReady(page, 12);
    },
  );
  await check(
    "mobile tidak overflow; drawer/modal berada di atas seluruh pane Leaflet",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await fullMap(page, 12);
      // Desktop -> ponsel mengubah margin sidebar dengan transisi 200ms.
      await page.waitForFunction(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page
        .getByRole("button", { name: "Buka menu", exact: true })
        .click();
      const nav = page.getByRole("link", {
        name: "Peta Jaringan / KMZ",
        exact: true,
      });
      const box = await nav.boundingBox();
      assert.ok(
        await page.evaluate(
          ({ x, y }) => !!document.elementFromPoint(x, y)?.closest("nav"),
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        ),
      );
      await page
        .getByRole("button", { name: "Tutup menu", exact: true })
        .click();
      const dialog = await openGps(page, "ODC", f.N.id);
      assert.ok(await dialog.isVisible());
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
      await page.screenshot({
        path: path.join(artifacts, "peta-mobile.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({
        path: path.join(artifacts, "peta-desktop.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "kredit/layar penuh 320/390px muat viewport; keyboard tetap di peta dan bisa keluar",
    async () => {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForFunction(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        );
        assert.equal(
          await page.locator(".network-map-shell").evaluate((shell) => {
            const c = shell
                .querySelector(".leaflet-control-attribution")
                .getBoundingClientRect(),
              t = shell
                .querySelector(".network-map-toolbar")
                .getBoundingClientRect(),
              m = shell.getBoundingClientRect();
            return (
              c.left >= m.left - 1 &&
              c.right <= m.right + 1 &&
              c.bottom <= m.bottom + 1 &&
              !(
                c.left < t.right &&
                c.right > t.left &&
                c.top < t.bottom &&
                c.bottom > t.top
              )
            );
          }),
          true,
          "Kredit tidak tertutup tombol pada mode biasa",
        );
        await page
          .getByRole("button", { name: "Peta layar penuh", exact: true })
          .click();
        const full = page.getByRole("dialog", {
          name: "Peta jaringan layar penuh",
          exact: true,
        });
        await full.waitFor();
        assert.match(
          await full.locator(".leaflet-control-attribution").innerText(),
          /Esri/,
        );
        assert.equal(
          await full.evaluate((shell) => {
            const c = shell
                .querySelector(".leaflet-control-attribution")
                .getBoundingClientRect(),
              t = shell
                .querySelector(".network-map-toolbar")
                .getBoundingClientRect();
            return (
              c.left >= -1 &&
              c.right <= innerWidth + 1 &&
              c.bottom <= innerHeight + 1 &&
              !(
                c.left < t.right &&
                c.right > t.left &&
                c.top < t.bottom &&
                c.bottom > t.top
              )
            );
          }),
          true,
        );

        await page.waitForFunction(
          () =>
            document.querySelector(".network-map-canvas")?.clientHeight >
            innerHeight * 0.8,
        );
        const box = await full.boundingBox();
        assert.ok(
          Math.abs(box.x) < 1 &&
            Math.abs(box.y) < 1 &&
            Math.abs(box.width - width) < 1 &&
            Math.abs(box.height - 844) < 1,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          true,
        );
        await full
          .getByRole("button", { name: "Keluar layar penuh", exact: true })
          .focus();
        await page.keyboard.press("Shift+Tab");
        assert.equal(
          await page.evaluate(
            () => !!document.activeElement.closest(".network-map-fullpage"),
          ),
          true,
        );
        await page.screenshot({
          path: path.join(artifacts, `peta-layar-penuh-mobile-${width}.png`),
          fullPage: false,
        });
        await full
          .getByRole("button", { name: "Keluar layar penuh", exact: true })
          .click();
        await full.waitFor({ state: "hidden" });
        assert.equal(
          await page.evaluate(() => document.body.style.overflow),
          "",
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    },
  );
  await check(
    "peran pembaca tidak melihat form GPS, tetap dapat KMZ; API menolak tulis",
    async () => {
      const ctx = await context(),
        reader = await ctx.newPage();
      debugPage = reader;
      await loginPage(reader, readerEmail, readerPassword);
      await reader.evaluate(() =>
        localStorage.setItem(
          "fiberops_arena_user",
          JSON.stringify({ id: 1, role: "admin" }),
        ),
      );
      await toMap(reader, 12);
      assert.equal(
        await reader
          .getByRole("button", { name: /Atur koordinat|Atur GPS/ })
          .count(),
        0,
      );
      assert.equal(
        await reader.getByRole("button", { name: "GPS", exact: true }).count(),
        0,
      );
      const status = await reader.evaluate(
        async (id) =>
          (
            await fetch(`/api/olts/${id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ latitude: 0, longitude: 0 }),
            })
          ).status,
        f.A.id,
      );
      assert.equal(status, 403);
      const kmz = await download(reader, "Unduh KMZ Lengkap (12 titik)");
      assert.equal(kmz.doc.querySelectorAll("Point").length, 12);
      kmz.dom.window.close();
      await reader
        .getByRole("button", { name: "Peta layar penuh", exact: true })
        .click();
      await reader
        .getByRole("dialog", { name: "Peta jaringan layar penuh", exact: true })
        .waitFor();
      await reader.goto(BASE + "/dashboard");
      await reader
        .getByRole("heading", { name: "Dashboard", exact: true })
        .waitFor();
      assert.equal(
        await reader.evaluate(() => document.body.style.overflow),
        "",
      );
      await ctx.close();
      debugPage = page;
    },
  );
  await check(
    "keluar sesi saat aset ekspor pending membatalkan unduhan terlambat",
    async () => {
      const ctx = await context(),
        reader = await ctx.newPage();
      debugPage = reader;
      await loginPage(reader, readerEmail, readerPassword);
      await toMap(reader, 12);
      let arrived, fulfilled;
      const seen = new Promise((resolve) => {
        arrived = resolve;
      });
      const finished = new Promise((resolve) => {
        fulfilled = resolve;
      });
      const gate = new Promise((resolve) => {
        releaseGate = resolve;
      });
      await reader.route("**/assets/olt-*.png", async (route) => {
        if (route.request().resourceType() !== "fetch") return route.continue();
        arrived();
        await gate;
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: fs.readFileSync(path.join(ROOT, "src/assets/map/olt.png")),
        });
        fulfilled();
      });
      const before = downloads.length;
      await reader
        .getByRole("button", {
          name: "Unduh KMZ Lengkap (12 titik)",
          exact: true,
        })
        .click();
      await seen;
      await reader.getByRole("button", { name: /Keluar|Logout/ }).click();
      await reader.waitForURL(BASE + "/login");
      releaseGate();
      releaseGate = null;
      await finished;
      await reader.waitForLoadState("networkidle");
      await reader.unroute("**/assets/olt-*.png");
      assert.equal(downloads.length, before);
      await ctx.close();
      debugPage = page;
    },
  );
  await check(
    "semua koordinat kosong tidak membuat marker 0,0; ekspor dinonaktifkan",
    async () => {
      const ctx = await context(),
        empty = await ctx.newPage();
      debugPage = empty;
      await loginPage(empty);
      const snapshot = await request("GET", "/api/map-data");
      for (const kind of ["olts", "odcs", "odps"])
        for (const row of snapshot[kind])
          Object.assign(row, {
            coordinate_mode: "none",
            latitude: null,
            longitude: null,
          });
      await empty.route(BASE + "/api/map-data", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(snapshot),
        }),
      );
      await toMap(empty, 0);
      assert.equal(
        await empty.locator(".network-map-marker,.network-map-cluster").count(),
        0,
      );
      assert.ok(
        await empty
          .getByRole("button", {
            name: "Unduh KMZ Lengkap (0 titik)",
            exact: true,
          })
          .isDisabled(),
      );
      await ctx.close();
      debugPage = page;
    },
  );
  await check(
    "kanvas/plugin gagal dimuat tidak mematikan daftar dan KMZ",
    async () => {
      const ctx = await context(),
        fallback = await ctx.newPage();
      debugPage = fallback;
      await fallback.route("**/assets/leaflet.markercluster-*.js", (route) =>
        route.abort("failed"),
      );
      await loginPage(fallback);
      await fallback.goto(BASE + "/peta");
      await fallback
        .getByRole("alert")
        .filter({ hasText: /Kanvas peta belum tersedia/ })
        .waitFor();
      const kmz = await download(fallback, "Unduh KMZ Lengkap (12 titik)");
      assert.equal(kmz.doc.querySelectorAll("Point").length, 12);
      kmz.dom.window.close();
      await ctx.close();
      debugPage = page;
    },
  );
  await check(
    "tidak ada token URL atau exception JavaScript dari alur nyata",
    () => {
      assert.ok(requests.length > 30);
      assert.ok(
        requests.every(
          (req) =>
            ![...new URL(req.url()).searchParams.keys()].some(
              (key) => key.toLowerCase() === "token",
            ),
        ),
      );
      for (const request of tileCalls) assertSatelliteRequest(request);
      assert.deepEqual(externalRequests, []);
      assert.deepEqual(exceptions, []);
    },
  );
  console.log(`\nBROWSER PETA: ${passed} pemeriksaan lulus.\n`);
} catch (error) {
  if (debugPage && !debugPage.isClosed()) {
    await debugPage
      .screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true })
      .catch(() => {});
    console.error(
      "Halaman saat gagal:",
      debugPage.url(),
      await debugPage.locator("h1,h2,[role=alert]").allTextContents(),
      "Exception:",
      exceptions,
    );
  }
  throw error;
} finally {
  releaseGate?.();
  if (browser) await browser.close();
  await stop();
  fs.rmSync(TMP, { recursive: true, force: true });
}
