// E2E opt-in: npm run build && CHROMIUM_EXECUTABLE=/path/chromium npm run test:browser
// Memakai Chromium nyata, DB sementara, build production, tanpa menonaktifkan web security.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dashboardFixture } from "./dashboard-fixture.mjs";
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),TMP=fs.mkdtempSync(path.join(os.tmpdir(),"fiber-browser-audit-"));
const PORT=Number(process.env.UJI_BROWSER_PORT||4790),BASE=`http://127.0.0.1:${PORT}`,ATTACKER=`http://127.0.0.1:${PORT+3}`,DB=path.join(TMP,"browser.db");
const artifacts=process.env.BROWSER_ARTIFACTS||path.join(TMP,"artifacts");fs.mkdirSync(artifacts,{recursive:true});
const email="owner@browser.test",password="OwnerBrowserStrong123!",readerEmail="reader@browser.test",readerPassword="ReaderBrowserStrong123!";
let app,browser,attacker,token,releasePatch,debugPage,passed=0;const exceptions=[],requests=[];
async function check(name,test){await test();passed++;console.log(`  OK    ${name}`);}
async function start(mode){let log="";app=spawn(process.execPath,["server.mjs"],{cwd:ROOT,env:{...process.env,NODE_ENV:mode,ARENA_API_HOST:"127.0.0.1",ARENA_API_PORT:String(PORT),ARENA_DB_PATH:DB,ARENA_PUBLIC_ORIGIN:BASE,ARENA_SECURE_COOKIES:"0"},stdio:["ignore","pipe","pipe"]});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(log)),15000);app.stdout.on("data",d=>{log+=d;if(log.includes("siap di")){clearTimeout(timer);resolve();}});app.stderr.on("data",d=>{log+=d;});app.once("error",e=>{clearTimeout(timer);reject(e);});app.once("exit",code=>{clearTimeout(timer);reject(Error(`App ${code}: ${log}`));});});}
async function stop(){if(app&&app.exitCode==null&&app.signalCode==null){const done=once(app,"exit");app.kill();await done;}app=null;}
async function request(method,route,body,expected=method==="POST"?201:200){const response=await fetch(BASE+route,{method,headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,expected,`${method} ${route}: ${JSON.stringify(data)}`);return data;}
async function loginApi(e,p){const data=await request("POST","/api/login",{email:e,password:p},200);token=data.token;return data;}
async function context({stripStandardAuth=false,...options}={}){const ctx=await browser.newContext({...options,acceptDownloads:true});ctx.setDefaultTimeout(10000);ctx.on("page",page=>{page.on("pageerror",e=>exceptions.push(e.message));page.on("request",r=>{if(r.url().startsWith(BASE+"/api/"))requests.push(r);});});await ctx.route("**/*",route=>{const u=new URL(route.request().url());if(u.hostname!=="127.0.0.1"&&u.protocol!=="blob:")return route.abort();
    if(stripStandardAuth){const headers={...route.request().headers()};delete headers.authorization;delete headers.cookie;return route.continue({headers});}return route.continue();});return ctx;}
async function loginPage(page,e=email,p=password){await page.goto(BASE+"/login");await page.getByLabel("Email",{exact:true}).fill(e);await page.getByLabel("Password",{exact:true}).fill(p);await page.getByRole("button",{name:"Masuk",exact:true}).click();await page.waitForURL(BASE+"/");await page.getByRole("heading",{name:"Alur Core OLT → ODC → ODP",exact:true}).waitFor();}
const snapshotOlt=async id=>(await request("GET","/api/dashboard")).oltDevices.find(o=>o.id===id);
try{
  console.log("\n=== BROWSER CHROMIUM / BUILD PRODUCTION ===");
  await start("development");await loginApi("admin@arena.test","Arena123!");
  await request("POST","/api/users",{email,password,full_name:"Pemilik uji",role:"admin"});await request("POST","/api/users",{email:readerEmail,password:readerPassword,full_name:"Pembaca uji",role:"user"});
  const f=await dashboardFixture(request);
  await request("PATCH",`/api/cards/${f.a2.id}`,{...f.a2,label:'<img src=x onerror="window.__storedXss=1">'});
  await request("PATCH",`/api/olts/${f.B.id}`,{...f.B,name:"=1+1"});await request("PATCH",`/api/olts/${f.empty.id}`,{...f.empty,olt_type:"Model Manual Lama"});
  await stop();await start("production");await loginApi(email,password);
  const executablePath=process.env.CHROMIUM_EXECUTABLE||["/usr/bin/chromium","/usr/bin/chromium-browser","/usr/bin/google-chrome"].find(p=>fs.existsSync(p));
  if(!executablePath)throw Error("Set CHROMIUM_EXECUTABLE ke Chromium lokal. Browser tidak diunduh otomatis.");
  const args=JSON.parse(process.env.CHROMIUM_ARGS||"[]").filter(a=>!["--disable-web-security","--allow-running-insecure-content","--disable-site-isolation-trials","--single-process"].includes(a)&&!a.startsWith("--disable-features=")&&!a.startsWith("--enable-features="));
  browser=await chromium.launch({executablePath,headless:true,args});console.log(`Chromium ${browser.version()}; web security aktif; fixture sementara.`);
  const desktop=await context({viewport:{width:1440,height:1000}}),page=await desktop.newPage();debugPage=page;
  await check("login produksi melalui browser dan reload memulihkan sesi sendiri",async()=>{await loginPage(page);await page.reload();await page.getByRole("heading",{name:"Alur Core OLT → ODC → ODP",exact:true}).waitFor();const cookie=(await desktop.cookies()).find(c=>c.name==="fiberops_token");assert.ok(cookie?.httpOnly);assert.equal(cookie.sameSite,"Lax");});
  await check("dashboard menampilkan model/card asli, shelf/slot, aktif dan terpakai yang tidak dijumlahkan",async()=>{
    await page.goto(BASE+"/dashboard");await page.locator(`[data-olt-device="${f.A.id}"]`).waitFor();
    const row=page.locator(`[data-olt-card="${f.a1.id}"]`);assert.deepEqual(await row.locator("td").allTextContents(),["8","5","2","21 feeder belum dipetakan"]);assert.match(await page.locator(`[data-olt-card="${f.a2.id}"]`).innerText(),/GTHG/);assert.match(await page.locator(`[data-olt-card="${f.a3.id}"]`).innerText(),/Shelf 2/);
    const d=await snapshotOlt(f.A.id);assert.equal(d.cardCount,3);assert.equal(d.portsActive,3);assert.equal(d.portsUsed,2);await page.screenshot({path:path.join(artifacts,"dashboard-desktop.png"),fullPage:true});
  });
  await check("nama/catatan tersimpan diperlakukan sebagai teks, bukan HTML aktif",async()=>{assert.equal(await page.evaluate(()=>window.__storedXss),undefined);assert.equal(await page.locator('[data-olt-card] img').count(),0);assert.match(await page.locator(`[data-olt-card="${f.a2.id}"]`).innerText(),/<img src=x/);});
  await check("tautan rincian dashboard membuka ID OLT tepat dan form mempertahankan tipe card tak dikenal",async()=>{
    await page.locator(`[data-olt-device="${f.A.id}"]`).getByRole("link",{name:/Rincian OLT/}).click();await page.waitForURL(BASE+`/olt?olt=${f.A.id}`);await page.getByTitle("Edit card shelf 1 slot 2",{exact:true}).click();const form=page.getByRole("dialog",{name:"Edit Card",exact:true});await form.waitFor();assert.equal(await form.getByLabel("Tipe Card",{exact:true}).inputValue(),"GTHG");
  });
  await check("form simpan lambat tidak dapat ditutup atau diubah hingga server menjawab",async()=>{
    const form=page.getByRole("dialog",{name:"Edit Card",exact:true});await form.getByLabel("Label Card",{exact:true}).fill("Edit label aman");let arrived;const seen=new Promise(r=>arrived=r),gate=new Promise(r=>releasePatch=r);
    await page.route(BASE+`/api/cards/${f.a2.id}`,async route=>{if(route.request().method()==="PATCH"){arrived();await gate;}await route.continue();});
    await form.getByRole("button",{name:"Simpan",exact:true}).click();await seen;await page.keyboard.press("Escape");assert.ok(await form.isVisible());assert.ok(await form.getByLabel("Label Card",{exact:true}).isDisabled());await form.getByRole("button",{name:"Tutup",exact:true}).click();assert.ok(await form.isVisible());releasePatch();releasePatch=null;await form.waitFor({state:"hidden"});await page.unroute(BASE+`/api/cards/${f.a2.id}`);
    assert.equal((await request("GET",`/api/cards?olt_id=${f.A.id}`)).find(c=>c.id===f.a2.id).card_type,"GTHG");
  });
  await check("edit model OLT tersimpan tidak otomatis menggantinya dengan model bawaan",async()=>{await page.goto(BASE+`/olt?olt=${f.empty.id}`);await page.getByTitle(`Edit OLT ${f.empty.name}`,{exact:true}).click();const form=page.getByRole("dialog",{name:"Edit OLT",exact:true});assert.equal(await form.getByLabel("Tipe OLT",{exact:true}).inputValue(),"Model Manual Lama");await form.getByLabel("Lokasi",{exact:true}).fill("Ruang pengujian");await form.getByRole("button",{name:"Simpan",exact:true}).click();await form.waitFor({state:"hidden"});assert.equal((await request("GET","/api/olts")).find(o=>o.id===f.empty.id).olt_type,"Model Manual Lama");});
  await check("mapping manual lewat form menaikkan port terpakai tepat satu, tanpa mengubah status aktif",async()=>{
    await page.goto(BASE+`/mapping?odc=${f.da.id}`);await page.getByRole("button",{name:"Petakan interface",exact:true}).click();await page.getByLabel("Core kabel feeder ODC",{exact:true}).selectOption("3");await page.getByLabel("Interface sumber dari OLT",{exact:true}).selectOption(String(f.aPorts[3].id));await page.getByRole("button",{name:"Simpan mapping interface",exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});const d=await snapshotOlt(f.A.id);assert.equal(d.portsUsed,3);assert.equal(d.portsActive,3);
  });
  await check("CSV nyata terunduh mengikuti filter dan menetralkan formula spreadsheet",async()=>{
    await page.goto(BASE+"/laporan");await page.getByLabel("OLT laporan interface",{exact:true}).selectOption(String(f.B.id));const downloading=page.waitForEvent("download");await page.getByRole("button",{name:"CSV",exact:true}).click();const file=await downloading;const contents=fs.readFileSync(await file.path(),"utf8");assert.match(contents,/"'=1\+1"/);assert.ok(!contents.includes("OLT-001"));assert.ok(!await file.failure());
  });
  await check("PDF build produksi dirender pada canvas dengan worker MIME JavaScript dan terunduh valid",async()=>{
    await page.getByLabel("OLT laporan interface",{exact:true}).selectOption(String(f.A.id));const worker=page.waitForResponse(r=>r.url().includes("pdf.worker")&&r.url().endsWith(".mjs"));await page.getByRole("button",{name:"Lihat PDF",exact:true}).click();const response=await worker;assert.match(response.headers()["content-type"],/javascript/);await page.locator('canvas').first().waitFor({timeout:20000});assert.ok(await page.locator('canvas').first().evaluate(c=>c.width>0&&c.height>0));assert.equal(await page.getByText(/Pratinjau gagal/).count(),0);
    const downloading=page.waitForEvent("download");await page.getByRole("link",{name:"Unduh",exact:true}).click();const downloaded=await downloading;assert.equal(fs.readFileSync(await downloaded.path()).subarray(0,5).toString(),"%PDF-");await page.screenshot({path:path.join(artifacts,"pdf-production.png"),fullPage:true});await page.getByRole("button",{name:"Tutup pratinjau",exact:true}).click();
  });
  await check("menu, accordion dan dashboard mobile dapat dipakai tanpa overflow halaman",async()=>{await page.setViewportSize({width:390,height:844});await page.goto(BASE+"/dashboard");const device=page.locator(`[data-olt-device="${f.A.id}"]`);await device.waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await device.locator("summary").click();assert.equal(await device.getAttribute("open"),null);await device.locator("summary").click();await page.getByRole("button",{name:"Buka menu",exact:true}).click();await page.getByRole("button",{name:"Tutup menu",exact:true}).click();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifacts,"dashboard-mobile.png"),fullPage:true});});
  await check("browser Origin asing dengan cookie valid mendapat 403 tanpa menambah inventaris",async()=>{
    attacker=http.createServer((req,res)=>{res.writeHead(200,{"content-type":"text/html"});res.end("<!doctype html><title>Uji Origin asing</title>");});await new Promise(resolve=>attacker.listen(PORT+3,"127.0.0.1",resolve));const foreign=await desktop.newPage();await foreign.goto(ATTACKER);const before=await request("GET","/api/olts");const incoming=foreign.waitForResponse(BASE+"/api/olts");await foreign.evaluate(base=>fetch(base+"/api/olts",{method:"POST",mode:"no-cors",credentials:"include",headers:{"content-type":"text/plain"},body:JSON.stringify({name:"Tidak boleh dibuat oleh CSRF"})}),BASE);const response=await incoming;assert.equal(response.status(),403);assert.ok((await response.request().allHeaders()).cookie);assert.equal((await request("GET","/api/olts")).length,before.length);await foreign.close();
  });
  await check("peran baca tidak mendapat form tulis atau halaman pengguna, API tetap menolak write",async()=>{
    const readers=await context({viewport:{width:1280,height:900}}),reader=await readers.newPage();debugPage=reader;await loginPage(reader,readerEmail,readerPassword);await reader.goto(BASE+"/olt");await reader.getByRole("heading",{name:"Manajemen OLT",exact:true}).waitFor();assert.equal(await reader.getByRole("button",{name:"Tambah OLT",exact:true}).count(),0);const status=await reader.evaluate(async()=>{const r=await fetch("/api/olts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Ditolak reader"})});return r.status;});assert.equal(status,403);await reader.goto(BASE+"/users");await reader.waitForURL(BASE+"/");await reader.goto(BASE+"/laporan");await reader.waitForFunction(()=>[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="CSV"&&!b.disabled));assert.ok(await reader.getByRole("button",{name:"CSV",exact:true}).isEnabled());await readers.close();
  });
  await check("proxy yang menyaring Authorization/cookie tetap dapat login dan reload tanpa token URL",async()=>{
    const filtered=await context({stripStandardAuth:true}),p=await filtered.newPage();debugPage=p;await loginPage(p);await filtered.clearCookies();await p.reload();await p.getByRole("heading",{name:"Alur Core OLT → ODC → ODP",exact:true}).waitFor();
    // Header khusus dikirim SDK; fetch tanpa SDK/header di proxy yang sama memang 401.
    assert.equal(await p.evaluate(async()=> (await fetch("/api/me")).status),401);
    await p.goto(BASE+"/dashboard");await p.locator(`[data-olt-device="${f.A.id}"]`).waitFor();await filtered.close();debugPage=page;
  });
  await check("request UI tidak menaruh token pada URL dan tidak ada exception JavaScript",()=>{assert.ok(requests.length>20);assert.ok(requests.every(r=>![...new URL(r.url()).searchParams.keys()].some(k=>k.toLowerCase()==="token")));assert.deepEqual(exceptions,[]);});
  console.log(`\nBROWSER: ${passed} pemeriksaan lulus.\n`);
}catch(error){if(debugPage&&!debugPage.isClosed()){await debugPage.screenshot({path:path.join(artifacts,"failure.png"),fullPage:true}).catch(()=>{});console.error("Halaman saat gagal:",debugPage.url(),await debugPage.locator("h1,h2").allTextContents(),"Exception:",exceptions);}throw error;}finally{releasePatch?.();if(browser)await browser.close();if(attacker)await new Promise(resolve=>attacker.close(resolve));await stop();fs.rmSync(TMP,{recursive:true,force:true});}
