import { useMemo } from "react";

// Warna kabel fiber mengikuti standar TIA/EIA-598 (lima pertama)
const CABLES = [
  { color: "#2563eb", d: "M -40 120 C 380 60, 520 420, 800 450 S 1280 120, 1640 200" },
  { color: "#f97316", d: "M -40 360 C 300 300, 560 520, 800 470 S 1300 640, 1640 560" },
  { color: "#16a34a", d: "M -40 640 C 340 700, 520 430, 800 430 S 1260 260, 1640 300" },
  { color: "#8b5cf6", d: "M -40 820 C 260 760, 600 600, 800 560 S 1320 820, 1640 780" },
  { color: "#22d3ee", d: "M 1640 90 C 1300 150, 1100 420, 800 440 S 320 180, -40 260" },
  { color: "#facc15", d: "M 1640 420 C 1250 380, 1080 600, 800 540 S 360 500, -40 470" },
];

// Titik ujung kabel (pendaran cahaya di tepi layar)
const ENDS = CABLES.flatMap((c) => {
  const [sx, sy] = c.d.match(/-?\d+(\.\d+)?/g).slice(0, 2).map(Number);
  const nums = c.d.match(/-?\d+(\.\d+)?/g).map(Number);
  return [
    { x: sx, y: sy, color: c.color },
    { x: nums[nums.length - 2], y: nums[nums.length - 1], color: c.color },
  ];
});

export default function FiberBackground() {
  const reduce = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  return (
    <div className="fx-bg" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="fx-svg">
        <defs>
          <filter id="fx-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {CABLES.map((c, i) => (
            <path key={i} id={`fx-p${i}`} d={c.d} fill="none" />
          ))}
        </defs>

        {/* kabel redup sebagai dasar */}
        {CABLES.map((c, i) => (
          <path key={`base${i}`} d={c.d} fill="none" stroke={c.color} strokeOpacity={0.14} strokeWidth={2} />
        ))}

        {/* kilatan cahaya yang mengalir sepanjang kabel */}
        {CABLES.map((c, i) => (
          <path
            key={`trail${i}`}
            d={c.d}
            fill="none"
            stroke={c.color}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeDasharray="70 890"
            filter="url(#fx-glow)"
            className="fx-trail"
            style={{ animationDuration: `${3.2 + i * 0.6}s`, animationDelay: `${-i * 0.7}s` }}
          />
        ))}

        {/* partikel cahaya (titik) yang bergerak, dimatikan bila gerakan dikurangi */}
        {!reduce &&
          CABLES.flatMap((c, i) =>
            [0, 1].map((k) => (
              <circle key={`dot${i}-${k}`} r={3} fill={c.color} filter="url(#fx-glow)">
                <animateMotion
                  dur={`${5 + i * 0.8}s`}
                  begin={`${-k * 2.5 - i * 0.6}s`}
                  repeatCount="indefinite"
                  rotate="auto"
                >
                  <mpath href={`#fx-p${i}`} />
                </animateMotion>
              </circle>
            )),
          )}

        {/* titik ujung (port) yang berkedip */}
        {ENDS.map((e, i) => (
          <g key={`end${i}`} transform={`translate(${e.x} ${e.y})`}>
            <circle r={6} fill="none" stroke={e.color} strokeWidth={1.2} className="fx-port" style={{ animationDelay: `${(i % 5) * 0.4}s` }} />
            <circle r={2.5} fill={e.color} />
          </g>
        ))}
      </svg>
    </div>
  );
}
