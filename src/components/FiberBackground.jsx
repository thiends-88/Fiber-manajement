import { useEffect, useMemo, useState } from "react";

// Warna kabel fiber mengikuti standar TIA/EIA-598 (lima pertama)
const CABLES = [
  { color: "#2563eb", d: "M -40 120 C 380 60, 520 420, 800 450 S 1280 120, 1640 200" },
  { color: "#f97316", d: "M -40 360 C 300 300, 560 520, 800 470 S 1300 640, 1640 560" },
  { color: "#16a34a", d: "M -40 640 C 340 700, 520 430, 800 430 S 1260 260, 1640 300" },
  { color: "#8b5cf6", d: "M -40 820 C 260 760, 600 600, 800 560 S 1320 820, 1640 780" },
  { color: "#22d3ee", d: "M 1640 90 C 1300 150, 1100 420, 800 440 S 320 180, -40 260" },
  { color: "#facc15", d: "M 1640 420 C 1250 380, 1080 600, 800 540 S 360 500, -40 470" },
];

// Titik ujung kabel (port di tepi layar)
const ENDS = CABLES.flatMap((c) => {
  const nums = c.d.match(/-?\d+(\.\d+)?/g).map(Number);
  return [
    { x: nums[0], y: nums[1], color: c.color },
    { x: nums[nums.length - 2], y: nums[nums.length - 1], color: c.color },
  ];
});

/**
 * Latar layar login: kabel fiber dengan cahaya yang mengalir.
 *
 * Dibuat ringan agar mengetik di form tidak tersendat:
 *   • tidak ada filter SVG (feGaussianBlur) — dulu setiap elemen beranimasi
 *     diraster ulang lewat filter tiap frame; pendaran kini ditiru dengan satu
 *     garis "halo" tebal transparan yang statis (sekali gambar);
 *   • tidak ada animasi SMIL (animateMotion) — 12 titik berfilter itu
 *     menggerakkan main thread setiap frame;
 *   • hanya properti ringan yang dianimasikan (stroke-dashoffset, opacity,
 *     transform), dan sebagian jalur dimatikan di layar sempit lewat CSS;
 *   • berhenti total saat gerakan dikurangi (prefers-reduced-motion) dan
 *     dijeda saat tab tidak terlihat.
 * Penjedaan saat pengguna mengetik ditangani murni di CSS (styles.css).
 */
export default function FiberBackground() {
  const reduce = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  // Tab disembunyikan → tidak ada gunanya terus menggambar animasi.
  const [tersembunyi, setTersembunyi] = useState(false);

  useEffect(() => {
    if (reduce || typeof document === "undefined") return undefined;
    const sinkron = () => setTersembunyi(document.hidden);
    document.addEventListener("visibilitychange", sinkron);
    return () => document.removeEventListener("visibilitychange", sinkron);
  }, [reduce]);

  return (
    <div className={`fx-bg${tersembunyi ? " fx-paused" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="fx-svg">
        <defs>
          {CABLES.map((c, i) => (
            <path key={i} id={`fx-p${i}`} d={c.d} fill="none" />
          ))}
        </defs>

        {/* kabel redup sebagai dasar */}
        {CABLES.map((c, i) => (
          <path key={`base${i}`} d={c.d} fill="none" stroke={c.color} strokeOpacity={0.14} strokeWidth={2} />
        ))}

        {/* pendaran (halo) statis — pengganti filter blur yang mahal */}
        {CABLES.map((c, i) => (
          <path key={`halo${i}`} d={c.d} fill="none" stroke={c.color} strokeOpacity={0.07} strokeWidth={7} strokeLinecap="round" />
        ))}

        {/* kilatan cahaya yang mengalir sepanjang kabel */}
        {CABLES.map((c, i) => (
          <path
            key={`trail${i}`}
            d={c.d}
            data-i={i}
            fill="none"
            stroke={c.color}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeDasharray="70 890"
            className="fx-trail"
            style={{ animationDuration: `${3.6 + i * 0.6}s`, animationDelay: `${-i * 0.7}s` }}
          />
        ))}

        {/* titik ujung (port); hanya sebagian yang berkedip agar hemat gambar */}
        {ENDS.map((e, i) => (
          <g key={`end${i}`} transform={`translate(${e.x} ${e.y})`}>
            {!reduce && i % 2 === 0 && (
              <circle r={6} fill="none" stroke={e.color} strokeWidth={1.2} className="fx-port" style={{ animationDelay: `${(i % 5) * 0.4}s` }} />
            )}
            <circle r={2.5} fill={e.color} fillOpacity={0.85} />
          </g>
        ))}
      </svg>
    </div>
  );
}
