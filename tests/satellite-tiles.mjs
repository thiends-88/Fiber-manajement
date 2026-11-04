// Semua tile diuji lokal dengan PNG transparan, bukan citra penyedia live.
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
function chunk(type, data) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(1, 0);
header.writeUInt32BE(1, 4);
header[8] = 8;
header[9] = 6;
export const SATELLITE_FIXTURE_PNG = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(Buffer.alloc(5))),
  chunk("IEND", Buffer.alloc(0)),
]);
export const isSatelliteTile = (url) =>
  new URL(url).hostname === "server.arcgisonline.com";
export function assertSatelliteRequest(request) {
  const url = new URL(request.url());
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "server.arcgisonline.com");
  const match = url.pathname.match(
    /^\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)$/,
  );
  assert.ok(match, "URL ArcGIS harus z/row/column");
  const [z, row, column] = match.slice(1).map(Number);
  assert.ok(
    z >= 0 &&
      z <= 19 &&
      row >= 0 &&
      column >= 0 &&
      row < 2 ** z &&
      column < 2 ** z,
  );
  assert.deepEqual([...url.searchParams], [["blankTile", "false"]]);
  const headers = request.headers();
  assert.ok(
    !headers.authorization && !headers["x-fiberops-token"] && !headers.cookie,
    "Kredensial aplikasi tidak dikirim ke citra",
  );
}
