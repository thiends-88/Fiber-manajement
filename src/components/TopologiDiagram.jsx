import { useEffect, useMemo, useState } from "react";
import { GitBranch, Maximize2, Minus, Plus, Tag, X } from "lucide-react";
import { EDGE_STYLE, NODE_H, NODE_STYLE, NODE_W, buildTopologyGraph, buildUpstreamChains } from "../lib/topology.js";
import { Badge, Card, Empty } from "./ui.jsx";
import { STATUS } from "../lib/fiber.js";

const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5];

/** Diagram alur jaringan: OLT → ODC → splitter → ODP (bisa bertingkat). */
export default function TopologiDiagram({ olts, odcs, odps, splitters, links, feederPorts, cores = [] }) {
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [labels, setLabels] = useState(true);

  const graph = useMemo(
    () => buildTopologyGraph({ olts, odcs, odps, splitters, links, feederPorts, cores }),
    [olts, odcs, odps, splitters, links, feederPorts, cores],
  );

  // Alur core ke hulu dari simpul terpilih (OLT → … → simpul ini)
  const chains = useMemo(() => (selected ? buildUpstreamChains(graph, selected) : []), [graph, selected]);

  // Label otomatis disembunyikan bila garisnya terlalu banyak (biar tidak penuh)
  useEffect(() => {
    setLabels(graph.edges.length <= 45);
  }, [graph.edges.length]);

  // Sorot jalur (hulu + hilir) dari simpul yang dipilih
  const highlight = useMemo(() => {
    if (!selected) return null;
    const ns = new Set([selected]);
    const es = new Set();
    const walk = (start, dir) => {
      const queue = [start];
      while (queue.length) {
        const cur = queue.pop();
        const list = (dir === "up" ? graph.incoming : graph.outgoing).get(cur) ?? [];
        list.forEach((e) => {
          es.add(e.id);
          const next = dir === "up" ? e.from : e.to;
          if (!ns.has(next)) {
            ns.add(next);
            queue.push(next);
          }
        });
      }
    };
    walk(selected, "up");
    walk(selected, "down");
    return { ns, es };
  }, [selected, graph]);

  if (!graph.nodes.length) {
    return <Empty text="Belum ada data jaringan untuk digambar. Tambahkan OLT, ODC, atau ODP terlebih dahulu." />;
  }

  const node = selected ? graph.nodes.find((n) => n.id === selected) : null;
  const parentNames = node ? (graph.incoming.get(node.id) ?? []).map((e) => graph.nodes.find((n) => n.id === e.from)?.title) : [];
  const childNames = node ? (graph.outgoing.get(node.id) ?? []).map((e) => graph.nodes.find((n) => n.id === e.to)?.title) : [];
  const zoomIdx = ZOOMS.indexOf(zoom);

  return (
    <div>
      {/* alat bantu tampilan */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-mut">Klik simpul untuk menyorot jalurnya.</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="btn px-2 py-1"
            title="Perkecil"
            disabled={zoomIdx <= 0}
            onClick={() => setZoom(ZOOMS[Math.max(0, zoomIdx - 1)])}
          >
            <Minus size={13} />
          </button>
          <span className="w-10 text-center tabular-nums text-mut">{Math.round(zoom * 100)}%</span>
          <button
            className="btn px-2 py-1"
            title="Perbesar"
            disabled={zoomIdx >= ZOOMS.length - 1}
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIdx + 1)])}
          >
            <Plus size={13} />
          </button>
          <button className="btn px-2 py-1" title="Ukuran normal" onClick={() => setZoom(1)}>
            <Maximize2 size={13} />
          </button>
          <button
            className={`btn px-2 py-1 ${labels ? "border-acc text-ink" : ""}`}
            title="Tampilkan/sembunyikan label garis"
            onClick={() => setLabels((v) => !v)}
          >
            <Tag size={13} /> Label
          </button>
          {selected && (
            <button className="btn px-2 py-1" onClick={() => setSelected(null)}>
              <X size={13} /> Hapus sorotan
            </button>
          )}
        </div>
      </div>

      {/* legenda */}
      <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-mut">
        {Object.entries(NODE_STYLE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded" style={{ background: v.color }} />
            {v.label}
          </span>
        ))}
        <span className="mx-1 opacity-40">|</span>
        {Object.entries(EDGE_STYLE).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 rounded" style={{ background: v.color }} />
            {v.label}
          </span>
        ))}
      </div>
      <p className="mb-3 text-[11px] text-mut">
        Warna garis feed, cascade, dan output mengikuti warna core kabel ODC asal (TIA/EIA-598); titik kecil di kanan-bawah ODP menunjukkan core yang masuk.
      </p>

      <Card className="overflow-x-auto p-3">
        <svg
          width={graph.width * zoom}
          height={graph.height * zoom}
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          onClick={() => setSelected(null)}
          style={{ display: "block" }}
        >
          {/* garis penghubung */}
          {graph.edges.map((e) => {
            const dim = highlight && !highlight.es.has(e.id);
            return (
              <g key={e.id} opacity={dim ? 0.16 : 1}>
                <path
                  d={e.path}
                  fill="none"
                  stroke={e.color}
                  strokeWidth={highlight && highlight.es.has(e.id) ? 2.2 : 1.5}
                  strokeOpacity={e.dashed ? 0.75 : 0.9}
                  strokeDasharray={e.dashed ? "5 4" : undefined}
                />
                <polygon
                  points={`${e.x2},${e.y2} ${e.x2 - 7},${e.y2 - 4} ${e.x2 - 7},${e.y2 + 4}`}
                  fill={e.color}
                />
                {labels && (
                  <text
                    x={e.mx}
                    y={e.my}
                    fontSize={9}
                    textAnchor="middle"
                    fill={e.color}
                    stroke="var(--color-panel)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                  >
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* simpul */}
          {graph.nodes.map((n) => {
            const st = NODE_STYLE[n.kind] ?? NODE_STYLE.odc;
            const dim = highlight && !highlight.ns.has(n.id);
            const isSel = selected === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={dim ? 0.22 : 1}
                style={{ cursor: "pointer" }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelected(isSel ? null : n.id);
                }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  fill="var(--color-panel)"
                  stroke={isSel ? "var(--color-acc)" : "var(--color-line)"}
                  strokeWidth={isSel ? 2 : 1}
                />
                <rect x={0} y={0} width={4} height={NODE_H} rx={2} fill={st.color} />
                <text x={14} y={24} fontSize={12.5} fontWeight={600} fill="var(--color-ink)">
                  {n.title}
                </text>
                <text x={14} y={41} fontSize={10.5} fill="var(--color-mut)">
                  {n.sub}
                </text>
                {/* titik warna core masuk (TIA/EIA-598), kanan-bawah simpul ODP */}
                {n.kind === "odp" &&
                  (n.coreIn ?? []).slice(0, 8).map((c, i) => (
                    <circle
                      key={`${c.odcId}-${c.core}-${c.port ?? "d"}`}
                      cx={NODE_W - 10 - i * 12}
                      cy={NODE_H - 10}
                      r={4.5}
                      fill={c.hex}
                      stroke="var(--color-line)"
                      strokeWidth={0.8}
                    >
                      <title>{`core ${c.core} • Warna dari ${c.odcName} (${c.port != null ? `out ${c.port}` : "sambungan langsung"})`}</title>
                    </circle>
                  ))}
              </g>
            );
          })}
        </svg>
      </Card>

      {/* info simpul terpilih */}
      {node && (
        <Card className="mt-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge cls="bg-acc/15 text-ink" >{NODE_STYLE[node.kind]?.label}</Badge>
            <span className="font-semibold">{node.title}</span>
            <span className="text-mut">{node.sub}</span>
          </div>
          <div className="mt-2 grid gap-1 text-xs text-mut sm:grid-cols-2">
            <div>
              <span className="text-ink">Masuk dari: </span>
              {parentNames.length ? parentNames.join(", ") : "— (simpul awal)"}
            </div>
            <div>
              <span className="text-ink">Keluar ke: </span>
              {childNames.length ? childNames.join(", ") : "— (ujung)"}
            </div>
          </div>

          {node.kind === "odp" && node.coreIn?.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold">Core masuk (warna TIA/EIA-598)</div>
              <div className="flex flex-wrap gap-1.5">
                {node.coreIn.map((c) => (
                  <span
                    key={`${c.odcId}-${c.core}-${c.port ?? "d"}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 py-0.5 text-[11px]"
                  >
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/30" style={{ background: c.hex }} />
                    <span className="font-medium">Core {c.core}</span>
                    <span className="text-mut">
                      · {c.colorName} · {c.odcName} · {c.port != null ? `out ${c.port}` : "sambungan langsung"}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Core milik kabel ODP sendiri yang dipakai sebagai power/output ODP */}
          {node.kind === "odp" && node.powerCores?.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold">Core power ODP (kabel ODP sendiri)</div>
              <div className="flex flex-wrap gap-1.5">
                {node.powerCores.map((c) => (
                  <span
                    key={c.core}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 py-0.5 text-[11px]"
                  >
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/30" style={{ background: c.hex }} />
                    <span className="font-medium">Core {c.core}</span>
                    <span className="text-mut">
                      · {c.colorName} · {STATUS[c.status]?.label ?? c.status}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Alur core ke hulu: jawaban "core ini datang dari mana?" */}
          {chains.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
                <GitBranch size={13} className="text-cyan-400" /> Alur core sampai ke sini
              </div>
              <div className="space-y-1.5">
                {chains.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-1 text-[11px]">
                    {c.langkah.map((l, j) => (
                      <span key={l.node.id} className="flex items-center gap-1">
                        {j > 0 && (
                          <span className="text-mut">
                            {l.edge?.label ? <span className="mr-0.5 rounded bg-panel2 px-1">{l.edge.label}</span> : null}→
                          </span>
                        )}
                        <span
                          className="rounded-md border border-line bg-panel2 px-1.5 py-0.5 font-medium"
                          style={{ borderLeftColor: NODE_STYLE[l.node.kind]?.color, borderLeftWidth: 3 }}
                        >
                          {l.node.title}
                        </span>
                      </span>
                    ))}
                    {!c.lengkap && <span className="text-amber-300">(jalur terpotong — periksa data cascade)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
