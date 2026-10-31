import { Field } from "./ui.jsx";
import {
  coordinateText,
  locationCoordinates,
  resolveCoordinates,
} from "../lib/coordinates.js";

export default function CoordinateFields({ form, onChange }) {
  const mode = form.coordinate_mode ?? "location";
  const value = resolveCoordinates(form);
  function changeMode(next) {
    const legacy = locationCoordinates(form.location);
    onChange({
      ...form,
      coordinate_mode: next,
      latitude:
        next === "manual" && legacy.status === "valid" ? legacy.latitude : "",
      longitude:
        next === "manual" && legacy.status === "valid" ? legacy.longitude : "",
    });
  }
  return (
    <fieldset className="min-w-0 space-y-2 rounded-xl border border-line bg-panel2 p-3">
      <legend className="px-1 text-xs font-semibold">
        Koordinat peta · WGS84
      </legend>
      <Field label="Sumber koordinat peta">
        <select
          className="input"
          value={mode}
          onChange={(e) => changeMode(e.target.value)}
        >
          <option value="location">
            Baca dari Lokasi (termasuk data lama)
          </option>
          <option value="manual">Isi latitude / longitude terpisah</option>
          <option value="none">Tanpa titik peta</option>
        </select>
      </Field>
      {mode === "manual" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Latitude (lintang)">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              required
              maxLength={32}
              placeholder="-0.7912"
              value={form.latitude ?? ""}
              onChange={(e) => onChange({ ...form, latitude: e.target.value })}
            />
          </Field>
          <Field label="Longitude (bujur)">
            <input
              className="input"
              type="text"
              inputMode="decimal"
              required
              maxLength={32}
              placeholder="100.6488"
              value={form.longitude ?? ""}
              onChange={(e) => onChange({ ...form, longitude: e.target.value })}
            />
          </Field>
        </div>
      )}
      <p
        className={`break-words text-xs ${value.status === "valid" ? "text-emerald-400" : value.status === "invalid" ? "text-red-400" : "text-mut"}`}
        role="status"
      >
        {value.status === "valid"
          ? `Terbaca: ${coordinateText(value)}`
          : value.reason}
      </p>
      <p className="text-[11px] text-mut">
        Urutan: latitude, longitude. Titik atau koma desimal boleh pada kolom
        terpisah. Alamat tetap disimpan; tidak ada geocoding atau titik 0,0
        otomatis. Pilih “Tanpa titik peta” untuk menghapus GPS tanpa menghapus
        Lokasi.
      </p>
    </fieldset>
  );
}
