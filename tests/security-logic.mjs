import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hashPassword, verifyPassword, validNewPassword, requestUrl, sameOriginWrite, sessionCookie, redactedUrl, createLoginLimiter, trustedProxySet, loginClientIp, canonicalPublicOrigin, validStoredPasswordHash } from "../server/security.mjs";
let passed=0;
const check=(name,test)=>{test();passed++;console.log(`  OK    ${name}`);};
const req=(headers={},method="POST",url="/api/olts")=>({headers:{host:"fiber.test:8080",...headers},method,url});
console.log("\n=== LOGIKA KEAMANAN PRA-DEPLOY ===");
check("scrypt menggunakan salt berbeda dan membedakan password benar/salah",()=>{
  const a=hashPassword("PasswordAman123!"),b=hashPassword("PasswordAman123!");assert.notEqual(a,b);assert.ok(verifyPassword("PasswordAman123!",a));assert.ok(!verifyPassword("Salah",a));
});
check("hash SHA-256 lama masih dapat diverifikasi tanpa mengubah akun",()=>{
  const hash=crypto.createHash("sha256").update("PasswordLama123").digest("hex");assert.ok(verifyPassword("PasswordLama123",hash));assert.ok(!verifyPassword("salah",hash));
});
check("hash rusak dan password nonteks tidak menyebabkan exception atau login",()=>{
  for(const hash of [null,"",{},"scrypt$bad$bad","x".repeat(64)])assert.equal(verifyPassword("x",hash),false);
  assert.equal(verifyPassword(["x"],"abc"),false);
  assert.ok(validStoredPasswordHash(hashPassword("PasswordFormat123!")));assert.ok(validStoredPasswordHash("a".repeat(64)));for(const value of [null,{},"broken","scrypt$bad$bad"])assert.equal(validStoredPasswordHash(value),false);
});
check("panjang dan tipe password dibatasi sebelum hashing",()=>{
  assert.ok(validNewPassword("abcdefgh"));assert.ok(!validNewPassword("abcdefg"));assert.ok(!validNewPassword("x".repeat(4097)));assert.ok(!validNewPassword(["abcdefgh"]));
});
check("origin publik disahkan saat startup; skema, path dan kredensial salah ditolak",()=>{
  assert.equal(canonicalPublicOrigin(),"");assert.equal(canonicalPublicOrigin("https://FIBER.test/"),"https://fiber.test");
  for(const origin of ["fiber.test","ftp://fiber.test","https://fiber.test/app","https://user:password@fiber.test","https://fiber.test?secret=x"])assert.throws(()=>canonicalPublicOrigin(origin));
});
check("URL relatif dan host IPv6 valid tetap diterima",()=>{
  assert.equal(requestUrl(req()).pathname,"/api/olts");assert.equal(requestUrl(req({host:"[::1]:8080"})).host,"[::1]:8080");
});
check("Host rusak, URL lintas host dan skema asing ditolak tanpa crash proses",()=>{
  for(const host of ["[","host.test/@other.test","host.test?x=1","bad host"])assert.throws(()=>requestUrl(req({host})));
  assert.throws(()=>requestUrl(req({},"GET","http://other.test/api/me")));assert.throws(()=>requestUrl(req({},"GET","file:///etc/passwd")));
});
check("Origin sama diperbolehkan tetapi subdomain/port berbeda tidak",()=>{
  assert.ok(sameOriginWrite(req({origin:"http://fiber.test:8080"})));
  assert.ok(!sameOriginWrite(req({origin:"http://evil.fiber.test:8080"})));assert.ok(!sameOriginWrite(req({origin:"http://fiber.test:9090"})));
});
check("Origin null, opaque dan Fetch Metadata cross-site ditolak pada write",()=>{
  for(const origin of ["null","file://","http://fiber.test:8080/","not-a-url"])assert.ok(!sameOriginWrite(req({origin})));
  assert.ok(!sameOriginWrite(req({"sec-fetch-site":"cross-site"})));
});
check("Origin publik HTTPS bekerja di reverse proxy HTTP tanpa mempercayai header IP/proto",()=>{
  const origin="https://fiber.test";
  assert.ok(sameOriginWrite(req({host:"127.0.0.1:4500",origin}),origin));
  assert.ok(!sameOriginWrite(req({origin:"https://evil.test","x-forwarded-host":"evil.test"}),origin));
});
check("GET serta klien CLI tanpa Origin tetap dapat memakai auth yang sah",()=>{
  assert.ok(sameOriginWrite(req({origin:"https://evil.test"},"GET")));assert.ok(sameOriginWrite(req()));
});
check("cookie login/logout konsisten HttpOnly, SameSite dan Secure sesuai konfigurasi",()=>{
  assert.match(sessionCookie("example",true),/HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
  assert.match(sessionCookie("",true),/Max-Age=0; Secure$/);assert.ok(!sessionCookie("x",false).includes("; Secure"));
});
check("semua bentuk nama parameter token dan duplikat disamarkan",()=>{
  for(const raw of ["/api/me?token=secret","/api/me?%74oken=secret","/api/me?TOKEN=secret","/api/me?token=secret&token=secret&olt=2"]){const logged=redactedUrl(raw);assert.ok(!logged.includes("secret"));}
  assert.match(redactedUrl("/api/ports?olt_id=2"),/olt_id=2/);
});
check("rate limit memiliki batas, Retry-After dan kedaluwarsa terukur",()=>{
  let time=1000;const allow=createLoginLimiter({limit:2,windowMs:1000,clock:()=>time});
  assert.equal(allow("a"),0);assert.equal(allow("a"),0);assert.equal(allow("a"),1);assert.equal(allow("b"),0);time=2001;assert.equal(allow("a"),0);
});
check("penyimpanan rate limiter dibatasi dan tidak membuang bucket aktif untuk melewati limit",()=>{
  const allow=createLoginLimiter({limit:1,maxEntries:1,clock:()=>1000});assert.equal(allow("a"),0);assert.ok(allow("b")>0);assert.ok(allow("a")>0);
});
check("header alamat klien tidak dipercaya tanpa peer proxy yang dikonfigurasi",()=>{
  const request={socket:{remoteAddress:"::ffff:127.0.0.1"},headers:{"x-real-ip":"198.51.100.2","x-forwarded-for":"198.51.100.3"}};
  assert.equal(loginClientIp(request),"127.0.0.1");assert.equal(loginClientIp(request,trustedProxySet("127.0.0.1, ::1")),"198.51.100.2");
  request.headers["x-real-ip"]="invalid, 198.51.100.2";assert.equal(loginClientIp(request,trustedProxySet("127.0.0.1")),"127.0.0.1");
});
check("konfigurasi trusted proxy yang salah ditolak, bukan mempercayai semua alamat",()=>{
  for(const raw of ["*","0.0.0.0/0","127.0.0.1:4500"])assert.throws(()=>trustedProxySet(raw));assert.equal(trustedProxySet().size,0);
});
console.log(`\nKEAMANAN LOGIKA: ${passed} pemeriksaan lulus.\n`);
