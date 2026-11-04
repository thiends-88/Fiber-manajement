// WGS84. Tidak melakukan geocoding, menukar urutan angka, atau mengubah lokasi lama.
export const COORDINATE_MODES = ["location", "manual", "none"];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const blank = (value) =>
  value == null || (typeof value === "string" && !value.trim());
const modeOf = (record) =>
  record.coordinate_mode ??
  (record.latitude != null || record.longitude != null ? "manual" : "location");

export function coordinateNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value !== "string" || value.length > 64) return NaN;
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return NaN;
  return Number(text.replace(",", "."));
}
function pair(latitude, longitude, source) {
  const lat = coordinateNumber(latitude),
    lng = coordinateNumber(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return {
      status: "invalid",
      reason: "Latitude dan longitude harus berupa dua angka desimal.",
    };
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return {
      status: "invalid",
      reason:
        "Latitude harus −90 sampai 90; longitude −180 sampai 180. Urutan tidak ditukar otomatis.",
    };
  return { status: "valid", latitude: lat, longitude: lng, source, reason: "" };
}

export function locationCoordinates(location) {
  const text = typeof location === "string" ? location.trim() : "";
  if (!text)
    return { status: "missing", reason: "Lokasi belum memuat koordinat." };
  if (text.length > 2048)
    return {
      status: "missing",
      reason: "Gunakan kolom GPS terpisah untuk koordinat yang jelas.",
    };
  // Titik/koma desimal tidak ambigu: pasangan dengan koma memakai titik desimal;
  // koma desimal hanya diterima jika pemisah pasangan adalah titik koma.
  const decimal = "([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))";
  const commaDecimal = "([+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+))";
  const plain = text.replace(/^\(\s*([^()]*)\s*\)$/, "$1").trim();
  const match =
    new RegExp(`^${decimal}\\s*,\\s*${decimal}$`).exec(plain) ||
    new RegExp(`^${commaDecimal}\\s*;\\s*${commaDecimal}$`).exec(plain) ||
    new RegExp(`^${decimal}\\s+${decimal}$`).exec(plain);
  if (match) return pair(match[1], match[2], "location");
  // DMS eksplisit dengan hemisfer; bukan tebakan dari angka pada alamat.
  const dms =
    /^(\d{1,2})\s*[°º]\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*["″]\s*([NS])\s*[,;]?\s*(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*["″]\s*([EW])$/i.exec(
      text,
    );
  if (dms) {
    if ([dms[2], dms[3], dms[6], dms[7]].some((v) => Number(v) >= 60))
      return {
        status: "invalid",
        reason: "Menit dan detik DMS harus kurang dari 60.",
      };
    const lat =
      (Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600) *
      (/S/i.test(dms[4]) ? -1 : 1);
    const lng =
      (Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7]) / 3600) *
      (/W/i.test(dms[8]) ? -1 : 1);
    return pair(lat, lng, "location");
  }
  // Hanya parameter titik eksplisit. @lat,lng adalah pusat viewport, BUKAN bukti titik.
  try {
    const url = new URL(text);
    if (
      url.protocol === "https:" &&
      /^(?:[a-z0-9-]+\.)*google\.com$/i.test(url.hostname)
    ) {
      for (const key of ["q", "query"]) {
        const value = url.searchParams.get(key);
        if (!value) continue;
        const found = new RegExp(`^${decimal}\\s*,\\s*${decimal}$`).exec(
          value.trim(),
        );
        if (found) return pair(found[1], found[2], "location");
      }
    }
  } catch {
    /* Alamat biasa bukan URL; tidak pernah di-fetch/geocode. */
  }
  return {
    status: "missing",
    reason:
      "Belum ada pasangan koordinat yang jelas. Isi GPS terpisah; alamat/tautan pendek tidak ditebak.",
  };
}

export function resolveCoordinates(record = {}) {
  const mode = modeOf(record);
  if (mode === "none")
    return {
      status: "missing",
      reason:
        "Titik dinonaktifkan secara eksplisit; lokasi lama tetap disimpan.",
    };
  if (mode === "location") return locationCoordinates(record.location);
  if (mode !== "manual")
    return { status: "invalid", reason: "Sumber koordinat tidak dikenal." };
  if (blank(record.latitude) && blank(record.longitude))
    return { status: "missing", reason: "GPS manual belum diisi." };
  return pair(record.latitude, record.longitude, "manual");
}

// Dipakai API dan form. Field GPS yang tidak dikirim pada PATCH tetap dipertahankan.
export function coordinateUpdate(body, current = {}) {
  const changed = ["latitude", "longitude", "coordinate_mode"].some((key) =>
    own(body, key),
  );
  if (!changed)
    return {
      latitude: current.latitude ?? null,
      longitude: current.longitude ?? null,
      coordinate_mode: modeOf(current),
    };
  let mode = own(body, "coordinate_mode") ? body.coordinate_mode : "manual";
  if (
    !own(body, "coordinate_mode") &&
    own(body, "latitude") &&
    own(body, "longitude") &&
    blank(body.latitude) &&
    blank(body.longitude)
  )
    mode = "none";
  const error = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  if (!COORDINATE_MODES.includes(mode))
    error("Sumber koordinat harus location, manual, atau none.");
  if (mode !== "manual") {
    if (
      ["latitude", "longitude"].some(
        (key) => own(body, key) && !blank(body[key]),
      )
    )
      error(
        "Hanya mode manual yang boleh mengirim latitude/longitude. Kosongkan pasangan GPS ketika mengganti sumber.",
      );
    return { latitude: null, longitude: null, coordinate_mode: mode };
  }
  const lat = own(body, "latitude")
    ? body.latitude
    : modeOf(current) === "manual"
      ? current.latitude
      : null;
  const lng = own(body, "longitude")
    ? body.longitude
    : modeOf(current) === "manual"
      ? current.longitude
      : null;
  const value = pair(lat, lng, "manual");
  if (value.status !== "valid") error(value.reason);
  return {
    latitude: value.latitude,
    longitude: value.longitude,
    coordinate_mode: "manual",
  };
}

export function coordinateForm(record = {}) {
  return {
    coordinate_mode: modeOf(record),
    latitude: record.latitude ?? "",
    longitude: record.longitude ?? "",
  };
}
export function coordinateText(point) {
  return point?.status === "valid"
    ? `${formatCoordinate(point.latitude)}, ${formatCoordinate(point.longitude)}`
    : "Belum ada koordinat";
}
export function formatCoordinate(value) {
  return (
    Number(value)
      .toFixed(8)
      .replace(/\.?0+$/, "") || "0"
  );
}
