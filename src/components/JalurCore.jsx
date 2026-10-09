import { ArrowRight } from "lucide-react";
import { Badge } from "./ui.jsx";
import { STATUS, colorForCoreInCable, coresPerTube } from "../lib/fiber.js";

/**
 * Komponen gambar "alur core" — dipakai bersama oleh halaman Alur Core
 * (topologi) dan Mapping Core supaya satu core digambar dengan cara yang sama
 * di mana pun teknisi melihatnya.
 *
 * Bentuk jalurnya mengikuti kenyataan di lapangan:
 *   core ODC (berwarna TIA/EIA-598) → splitter 1:4 → cascade splitter 1:8
 *   → core ke tiap ODP → splitter 1:8 di dalam ODP
 */

export function CoreChip({ core, cableType, small }) {
  const perTube = coresPerTube(cableType);
  const color = colorForCoreInCable(core, perTube);
  const tube = Math.floor((core - 1) / perTube) + 1;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 ${
        small ? "py-0.5 text-[11px]" : "py-1 text-xs"
      }`}
    >
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/30"
        style={{ background: color.hex }}
        title={color.name}
      />
      <span className="font-medium">Core {core}</span>
      <span className="text-mut">
        · {color.name} · Tube {tube}
      </span>
    </span>
  );
}

export function Arrow() {
  return <ArrowRight size={15} className="shrink-0 text-cyan-400" />;
}

/** Chip warna core yang masuk ke sebuah ODP (warna kabel ODC asal). */
export function FeedChip({ feed }) {
  if (!feed) return null;
  const color = colorForCoreInCable(feed.core, coresPerTube(feed.cableType));
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-1.5 py-0.5 text-[11px]">
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full border border-black/30"
        style={{ background: color.hex }}
        title={color.name}
      />
      <span className="font-medium">core {feed.core}</span>
      <span className="text-mut">· {color.name}</span>
    </span>
  );
}

/**
 * Pohon jalur core hasil buildCoreRoutes(): splitter → cascade / ODP / ODC anak.
 * `feed` = { core, cableType } core ODC yang mengalir ke pohon ini (penentu warna).
 */
export function PohonJalur({ node, feed }) {
  if (!node) return null;

  if (node.kind === "splitter") {
    return (
      <div className="rounded-lg border border-line bg-panel p-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {node.viaPort != null && <Badge cls="bg-violet-500/15 text-violet-300">via out {node.viaPort}</Badge>}
          <span className="font-semibold">{node.name}</span>
          <Badge cls="bg-violet-500/15 text-violet-300">Splitter {node.ratio}</Badge>
          {node.inputCore != null && <Badge cls="bg-slate-500/15 text-slate-300">input core {node.inputCore}</Badge>}
          {node.children.length === 0 && node.idlePorts === 0 && (
            <span className="text-mut">belum ada output terarah</span>
          )}
        </div>
        {(node.children.length > 0 || node.idlePorts > 0) && (
          <div className="ml-1.5 mt-2 space-y-2 border-l border-line pl-3">
            {node.children.map((c, i) => (
              <PohonJalur key={`${node.id}-${i}`} node={c} feed={feed} />
            ))}
            {node.idlePorts > 0 && (
              <div className="rounded-md border border-dashed border-line px-2 py-1 text-[11px] text-mut">
                {node.idlePorts} output belum diarahkan
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (node.kind === "odp") {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-panel px-2.5 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {node.port != null && <Badge cls="bg-violet-500/15 text-violet-300">out {node.port}</Badge>}
          <span className="font-semibold text-emerald-300">{node.name}</span>
          <span className="text-mut">{node.location || "lokasi belum diisi"}</span>
          <FeedChip feed={feed} />
        </div>
        {/* Core milik kabel ODP sendiri yang dipakai sebagai power/output.
            Kabel bisa berlanjut OLT → ODC → ODP dengan core berbeda, jadi
            warnanya dihitung dari tipe kabel ODP, bukan dari ODC asal. */}
        {node.powerCores?.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-mut">Core power ODP:</span>
            {node.powerCores.map((pc) => {
              const warna = colorForCoreInCable(pc.core, coresPerTube(node.cableType));
              return (
                <span
                  key={pc.core}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-1.5 py-0.5 text-[11px]"
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full border border-black/30"
                    style={{ background: warna.hex }}
                    title={warna.name}
                  />
                  <span className="font-medium">core {pc.core}</span>
                  <span className="text-mut">
                    · {warna.name} · {STATUS[pc.status]?.label ?? pc.status}
                  </span>
                </span>
              );
            })}
          </div>
        )}
        {node.insideSplitters.length > 0 && (
          <div className="mt-1 text-[11px] text-mut">
            Splitter di dalam ODP: {node.insideSplitters.map((s) => `${s.name} (${s.ratio})`).join(" · ")}
          </div>
        )}
      </div>
    );
  }

  if (node.kind === "odc") {
    return (
      <div className="rounded-lg border border-sky-500/40 bg-panel p-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {node.port != null && <Badge cls="bg-violet-500/15 text-violet-300">out {node.port}</Badge>}
          <span className="font-semibold text-sky-300">{node.name}</span>
          <Badge cls="bg-sky-500/15 text-sky-300">ODC anak</Badge>
        </div>
        {node.children.length > 0 ? (
          <div className="ml-1.5 mt-2 space-y-2 border-l border-line pl-3">
            {node.children.map((c, i) => (
              <PohonJalur key={`${node.odcId}-${i}`} node={c} feed={feed} />
            ))}
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-mut">belum ada splitter dengan input core di ODC ini</div>
        )}
      </div>
    );
  }

  if (node.kind === "terputus") {
    return (
      <div className="rounded-md border border-amber-500/40 bg-panel px-2 py-1 text-[11px] text-amber-300">
        out {node.port}: {node.note}
      </div>
    );
  }

  return null;
}
