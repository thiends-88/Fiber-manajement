// Kontrak snapshot peta; detail ODP memakai snapshot GET yang sama, bukan
// mencampur asal sambungan dan core dari beberapa waktu baca berbeda.
const KEYS = ["olts", "odcs", "odps", "ports", "feederPorts", "interfaceMappings", "links", "splitters"];
const row = item => item && typeof item === "object" && !Array.isArray(item);
export function validateMapSnapshot(data) {
  if (data?.version !== 1 || !KEYS.every(key => Array.isArray(data[key]) && data[key].every(row)) ||
    !data.splitters.every(s => Array.isArray(s.outputs) && s.outputs.every(row))) {
    throw new Error("Snapshot peta belum lengkap/valid. Periksa versi server lalu muat ulang; ekspor tidak memakai data setengah lengkap.");
  }
  return data;
}
export function validateOdpSnapshot(data, odpId) {
  validateMapSnapshot(data);
  const detail = data.odpDetail;
  if (detail?.odpId !== Number(odpId) || !Array.isArray(detail.cores) || !detail.cores.every(c => row(c) && c.source === "odc_to_odp" && Number(c.odp_id) === Number(odpId)) ||
    !data.odps.some(p => Number(p.id) === Number(odpId))) {
    throw new Error("Detail ODP belum lengkap atau tidak cocok dengan perangkat yang dipilih. Muat ulang detail.");
  }
  return data;
}
