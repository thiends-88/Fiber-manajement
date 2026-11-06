// Browser nyata + build production + SQLite SINTETIS. Tidak mengakses Proxmox.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright-core";
import { snapshot, compare } from "../scripts/check-existing-update.mjs";
import { deviceNavigationData } from "./fixtures/device-navigation-data.mjs";

const ROOT = path.resolve(import.meta.dirname, ".."), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-browser-navigation-"));
const PORT = Number(process.env.UJI_NAVIGATION_BROWSER_PORT || 4924), BASE = `http://127.0.0.1:${PORT}`, DB = path.join(tmp, "only-synthetic.db");
const artifacts = process.env.BROWSER_ARTIFACTS || path.join(tmp, "artifacts");fs.mkdirSync(artifacts, { recursive: true });
const accounts = {
  admin: { email: "owner@navigation-fixture.test", password: "NavigationOwnerPrivate123!" },
  operator: { email: "operator@navigation-fixture.test", password: "NavigationOperatorPrivate123!" },
  user: { email: "reader@navigation-fixture.test", password: "NavigationReaderPrivate123!" },
};
const env = { ...process.env, NODE_ENV: "production", ARENA_DB_PATH: DB, ARENA_API_HOST: "127.0.0.1", ARENA_API_PORT: String(PORT), ARENA_PUBLIC_ORIGIN: BASE, ARENA_SECURE_COOKIES: "0" };
let app, browser, token, passed = 0, debugPage, before;
const errors = [], requests = [], external = [];
const nodeFetch = globalThis.fetch;
async function request(method, route, body) {
  const response = await nodeFetch(BASE + route, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();assert.ok(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(data)}`);return data;
}
async function start() {
  let log = "";app = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(log)), 15000);
    app.stdout.on("data", data => { log += data;if (log.includes("siap di")) { clearTimeout(timer);resolve(); } });
    app.stderr.on("data", data => { log += data; });
    app.once("error", error => { clearTimeout(timer);reject(error); });
    app.once("exit", code => { clearTimeout(timer);reject(Error(`App ${code}: ${log}`)); });
  });
}
async function check(name, test) { await test();passed++;console.log(`OK ${name}`); }
async function holdGET(page, pattern, test) {
  let arrived, release;const seen = new Promise(resolve => { arrived = resolve; }), gate = new Promise(resolve => { release = resolve; });
  await page.route(pattern, async route => { arrived();await gate;try { await route.continue(); } catch (error) { errors.push(`Route GET: ${error.message}`); } });
  try { await test({ seen, release }); } finally { release();await page.unrouteAll({ behavior: "wait" }); }
}
async function context(options = {}) {
  const ctx = await browser.newContext(options);ctx.setDefaultTimeout(10000);
  ctx.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", req => { if (req.url().startsWith(BASE + "/api/")) requests.push({ method: req.method(), url: req.url() }); });
  });
  await ctx.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE && url.protocol !== "blob:") { external.push(url.origin);return route.abort(); }
    return route.continue();
  });
  return ctx;
}
async function login(page, role = "admin") {
  await page.goto(BASE + "/login");
  await page.getByLabel("Email", { exact: true }).fill(accounts[role].email);
  await page.getByLabel("Password", { exact: true }).fill(accounts[role].password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();await page.waitForURL(BASE + "/");
}
const row = (page, id) => page.locator(`[data-device-row="${id}"]`);
const opener = (page, id) => row(page, id).locator('button[aria-label^="Buka area input"]');
const heading = page => page.locator("[data-device-editor] h2[data-device-id]");
async function visibleTarget(locator) {
  await locator.waitFor();await locator.evaluate(node => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const rect = await locator.boundingBox(), viewport = locator.page().viewportSize();
  assert.ok(rect && rect.y >= 47 && rect.y < viewport.height - 32, `Target di luar viewport/tertutup topbar: ${JSON.stringify(rect)} ${JSON.stringify(viewport)}`);
  assert.ok(await locator.evaluate(node => document.activeElement === node), "Fokus tidak ikut ke target");
}
async function selected(page, id) {
  await page.waitForFunction(id => document.querySelector("[data-device-editor] h2[data-device-id]")?.dataset.deviceId === String(id) && document.activeElement === document.querySelector("[data-device-editor] h2[data-device-id]"), id);
  await visibleTarget(heading(page));
}
async function noOverflow(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Halaman overflow horizontal"); }
try {
  assert.ok(fs.existsSync(path.join(ROOT, "dist/index.html")), "Jalankan npm run build terlebih dahulu");
  const init = spawnSync(process.execPath, ["scripts/create-admin.mjs", accounts.admin.email], { cwd: ROOT, env, input: accounts.admin.password, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  await start();token = (await request("POST", "/api/login", accounts.admin)).token;
  for (const role of ["operator", "user"]) await request("POST", "/api/users", { ...accounts[role], full_name: `Pengguna ${role} UJI`, role });
  const data = await deviceNavigationData(request);before = snapshot(DB);
  const executablePath = process.env.CHROMIUM_EXECUTABLE || ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(file => fs.existsSync(file));
  assert.ok(executablePath, "Set CHROMIUM_EXECUTABLE ke Chromium lokal; tidak mengunduh browser otomatis");
  const args = JSON.parse(process.env.CHROMIUM_ARGS || "[]").filter(arg => !["--disable-web-security", "--allow-running-insecure-content", "--disable-site-isolation-trials", "--single-process"].includes(arg) && !arg.startsWith("--disable-features=") && !arg.startsWith("--enable-features="));
  browser = await chromium.launch({ executablePath, headless: true, args });
  console.log(`\n=== NAVIGASI ODC / ODP — CHROMIUM ${browser.version()} / SQLITE SINTETIS ===`);
  const desktop = await context({ viewport: { width: 1440, height: 1000 } }), page = await desktop.newPage();debugPage = page;
  await login(page);
  for (const [kind, records] of [["ODC", data.odcs], ["ODP", data.odps]]) {
    const lower = kind.toLowerCase(), first = records[0], last = records.at(-1);
    await check(`${kind}: daftar panjang tetap di atas sampai perangkat diklik`, async () => {
      await page.goto(BASE + `/${lower}`);await row(page, last.id).waitFor();
      assert.equal(await page.locator("[data-device-row]").count(), records.length);assert.equal(await heading(page).count(), 0);assert.ok(await page.evaluate(() => scrollY < 10));
    });
    await check(`${kind}: klik nama pertama langsung ke input, judul tidak tertutup topbar`, async () => {
      assert.ok(await row(page, last.id).evaluate(node => node.getBoundingClientRect().top > innerHeight), "Fixture harus lebih panjang dari satu layar");
      await opener(page, first.id).click();await selected(page, first.id);await noOverflow(page);assert.ok((await heading(page).boundingBox()).y <= 120, "Header harus dekat awal area layar, termasuk saat panel async baru dimuat");
      await page.screenshot({ path: path.join(artifacts, `${lower}-desktop.png`) });
    });
    await check(`${kind}: shortcut Core/interface/splitter dan kembali ke baris tanpa fetch ulang`, async () => {
      await page.waitForLoadState("networkidle");const count = requests.length;
      for (const [name, label] of [["Core", `Core ${kind} ${first.name}`], [kind === "ODC" ? "Interface feeder" : "Asal interface", `${kind === "ODC" ? "Interface feeder" : "Asal interface"} ${first.name}`], ["Splitter", `Splitter ${kind} ${first.name}`]]) {
        await page.getByRole("button", { name, exact: true }).click();await visibleTarget(page.getByRole("region", { name: label, exact: true }));
      }
      await page.getByRole("button", { name: `Kembali ke daftar ${kind}`, exact: true }).click();await visibleTarget(opener(page, first.id));assert.equal(requests.length, count);
    });
    await check(`${kind}: klik ulang perangkat sama tidak menutup atau reload panel`, async () => {
      const count = requests.length;await opener(page, first.id).click();await selected(page, first.id);assert.equal(requests.length, count);
    });
    await check(`${kind}: klik sel lain pada baris terakhir memilih ID yang benar`, async () => {
      await row(page, last.id).locator("td").nth(1).click();await selected(page, last.id);assert.ok(new URL(page.url()).searchParams.get(lower) === String(last.id));
    });
    await check(`${kind}: Enter dan Space membuka dua ID bernama sama tanpa menyatukan data`, async () => {
      for (const [record, key] of [[records[1], "Enter"], [records[2], "Space"]]) {
        await opener(page, record.id).focus();await page.keyboard.press(key);await selected(page, record.id);
        assert.equal(new URL(page.url()).searchParams.get(lower), String(record.id));
      }
      assert.equal(await page.locator("[data-device-row]").count(), records.length);
    });
    await check(`${kind}: pencarian tetap utuh, shortcut input bekerja saat pilihan tersembunyi`, async () => {
      const search = page.getByPlaceholder(`Cari ${kind} (nama, ${kind === "ODC" ? "OLT" : "ODC"}, lokasi, kabel)…`);
      await search.fill(first.name);await page.waitForFunction(() => document.querySelectorAll("[data-device-row]").length === 1);
      await page.getByRole("button", { name: `Ke area input ${kind} ${records[2].name}`, exact: true }).click();await selected(page, records[2].id);
      await page.getByRole("button", { name: `Kembali ke daftar ${kind}`, exact: true }).click();await visibleTarget(page.getByRole("region", { name: `Daftar ${kind}`, exact: true }));assert.equal(await search.inputValue(), first.name);
    });
    await check(`${kind}: deep link menunggu daftar terlambat tanpa memilih ID buatan`, async () => {
      await holdGET(page, BASE + `/api/${lower}s`, async ({ seen, release }) => {
        await page.goto(BASE + `/${lower}?${lower}=${first.id}`);await seen;assert.equal(await heading(page).count(), 0);assert.ok(await page.evaluate(() => scrollY < 10));
        release();await selected(page, first.id);assert.ok((await heading(page).boundingBox()).y <= 120);
      });
    });
    await check(`${kind}: Core lambat tidak menunda navigasi atau merebut ulang fokus setelah dimuat`, async () => {
      await holdGET(page, BASE + "/api/cores?**", async ({ seen, release }) => {
        await page.goto(BASE + `/${lower}?${lower}=${first.id}`);await seen;await selected(page, first.id);assert.ok(await page.getByTitle(/^Core 1 ·/).isDisabled(), "Core belum boleh diedit selama data tertahan");
        await page.getByRole("button", { name: "Core", exact: true }).click();const target = page.getByRole("region", { name: `Core ${kind} ${first.name}`, exact: true });await visibleTarget(target);const y = await page.evaluate(() => scrollY);
        release();await page.waitForLoadState("networkidle");assert.ok(await page.getByTitle(/^Core 1 ·/).isEnabled());await visibleTarget(target);assert.ok(Math.abs(await page.evaluate(() => scrollY) - y) <= 1, "Data selesai dimuat tidak boleh mengulang scroll");
      });
    });
    await check(`${kind}: deep link/reload/back/forward langsung ke perangkat yang sesuai`, async () => {
      await page.goto(BASE + `/${lower}?${lower}=${first.id}`);await selected(page, first.id);
      await opener(page, last.id).click();await selected(page, last.id);await page.goBack();await selected(page, first.id);await page.goForward();await selected(page, last.id);await page.reload();await selected(page, last.id);
    });
    await check(`${kind}: Edit dan Hapus-batal tidak memicu pemilihan/scroll area input`, async () => {
      await page.goto(BASE + `/${lower}`);await row(page, first.id).waitFor();await page.getByTitle(`Edit ${kind} ${first.name}`, { exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `Edit ${kind}`, exact: true });await dialog.waitFor();assert.equal(await heading(page).count(), 0);assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)));
      await dialog.getByRole("button", { name: "Tutup", exact: true }).click();await dialog.waitFor({ state: "hidden" });
      page.once("dialog", d => d.dismiss());await page.getByTitle(`Hapus ${kind} ${first.name}`, { exact: true }).click();assert.equal(await heading(page).count(), 0);assert.equal(new URL(page.url()).search, "");
    });
    await check(`${kind}: membuka/menutup modal core tidak memindahkan fokus ke latar`, async () => {
      await opener(page, first.id).click();await selected(page, first.id);await page.getByTitle(/^Core 2 ·/).click();
      const dialog = page.getByRole("dialog");await dialog.waitFor();await dialog.getByLabel("Catatan", { exact: true }).fill("Draft UJI tidak disimpan");
      await page.keyboard.press("Tab");assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)));
      await page.keyboard.press("Escape");await dialog.waitFor({ state: "hidden" });assert.ok(new URL(page.url()).searchParams.get(lower) === String(first.id));
    });
  }
  await check("ODC: query edit menjaga modal dan posisi daftar, bukan melompat ke latar", async () => {
    await page.goto(BASE + `/odc?odc=${data.odcs[0].id}&edit=1`);
    const dialog = page.getByRole("dialog", { name: "Edit ODC", exact: true });await dialog.waitFor();assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)));assert.ok(await page.evaluate(() => scrollY < 10));
    await dialog.getByRole("button", { name: "Tutup", exact: true }).click();await dialog.waitFor({ state: "hidden" });await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));assert.ok(await page.evaluate(() => scrollY < 10));
  });
  for (const width of [390, 320]) {
    const mobile = await context({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" }), mobilePage = await mobile.newPage();debugPage = mobilePage;await login(mobilePage);
    for (const [kind, records] of [["ODC", data.odcs], ["ODP", data.odps]]) await check(`${kind}: HP ${width}px/reduced motion langsung ke input, Core dan kembali tanpa overflow`, async () => {
      await mobilePage.goto(BASE + `/${kind.toLowerCase()}`);await opener(mobilePage, records[0].id).tap();await selected(mobilePage, records[0].id);await noOverflow(mobilePage);
      await mobilePage.getByRole("button", { name: "Core", exact: true }).tap();await visibleTarget(mobilePage.getByRole("region", { name: `Core ${kind} ${records[0].name}`, exact: true }));await noOverflow(mobilePage);
      await mobilePage.screenshot({ path: path.join(artifacts, `${kind.toLowerCase()}-${width}.png`) });
      await mobilePage.getByRole("button", { name: `Kembali ke daftar ${kind}`, exact: true }).tap();await visibleTarget(opener(mobilePage, records[0].id));
    });
    await mobile.close();
  }
  for (const role of ["operator", "user"]) {
    const ctx = await context({ viewport: { width: 1280, height: 900 } }), rolePage = await ctx.newPage();debugPage = rolePage;await login(rolePage, role);
    for (const [kind, records] of [["ODC", data.odcs], ["ODP", data.odps]]) await check(`${kind}: role ${role} dapat navigasi, hak tulis tidak bertambah`, async () => {
      await rolePage.goto(BASE + `/${kind.toLowerCase()}?${kind.toLowerCase()}=${records[0].id}${role === "user" && kind === "ODC" ? "&edit=1" : ""}`);await selected(rolePage, records[0].id);
      if (role === "user") { assert.equal(await rolePage.getByRole("button", { name: `Tambah ${kind}`, exact: true }).count(), 0);assert.equal(await rolePage.getByTitle(/^Edit (?:ODC|ODP) /).count(), 0);assert.ok(await rolePage.getByTitle(/^Core 1 ·/).isDisabled());assert.equal(await rolePage.getByRole("dialog").count(), 0); }
      else assert.ok(await rolePage.getByRole("button", { name: `Tambah ${kind}`, exact: true }).isVisible());
    });
    await ctx.close();
  }
  debugPage = page;
  await check("seluruh akun/hash/ID/field/core/mapping/splitter/sequence tetap identik", () => compare(before, DB));
  await check("navigasi tidak mengirim write data, token URL, request luar, atau exception JS", () => {
    assert.ok(requests.length > 40);assert.ok(requests.every(req => req.method === "GET" || (req.method === "POST" && new URL(req.url).pathname === "/api/login")));
    assert.ok(requests.every(req => ![...new URL(req.url).searchParams.keys()].some(key => key.toLowerCase() === "token")));assert.deepEqual(external, []);assert.deepEqual(errors, []);
  });
  console.log(`\nBROWSER NAVIGASI ODC/ODP: ${passed} pemeriksaan lulus; 62 ODC / 72 ODP sintetis, C300/C320, desktop/390/320px.\n`);
} catch (error) {
  if (debugPage && !debugPage.isClosed()) {
    await debugPage.screenshot({ path: path.join(artifacts, "navigation-failure.png"), fullPage: true }).catch(() => {});
    console.error("Halaman saat gagal:", debugPage.url(), "Fokus:", await debugPage.evaluate(() => document.activeElement?.outerHTML.slice(0, 300)).catch(() => ""), "Exception:", errors);
  }
  throw error;
} finally {
  await browser?.close();
  if (app && app.exitCode == null && app.signalCode == null) { const done = once(app, "exit");app.kill();await done; }
  fs.rmSync(tmp, { recursive: true, force: true });
}
