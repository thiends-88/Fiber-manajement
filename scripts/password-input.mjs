import { FACTORY_PASSWORD, validNewPassword } from "../server/security.mjs";
// Satu jalur validasi untuk provisioning/rotasi lokal; tidak membaca argv/env untuk password.
export async function passwordInput(script) {
  const email = (process.argv[2] || "").trim().toLowerCase();
  if (process.argv.length !== 3 || !/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) throw Error(`Gunakan: node scripts/${script} email (hanya email di argv; password melalui stdin)`);
  if (process.stdin.isTTY) throw Error("Kirim password melalui stdin tanpa menaruhnya di argumen/history. Ikuti panduan deployment.");
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 16386) throw Error("Password terlalu panjang"); chunks.push(chunk); }
  const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  if (!validNewPassword(password, 12) || password === FACTORY_PASSWORD) throw Error("Password baru harus 12–4096 karakter dan bukan password pabrik");
  return {email,password};
}
