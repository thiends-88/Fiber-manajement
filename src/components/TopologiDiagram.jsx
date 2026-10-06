import { useEffect, useMemo, useState } from "react";
import { Maximize2, Minus, Plus, Tag, X } from "lucide-react";
import { EDGE_STYLE, NODE_H, NODE_STYLE, NODE_W, buildTopologyGraph } from "../lib/topology.js";
import { Badge, Card, Empty } from "./ui.jsx";

const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5];

/** Diagram alur jaringan: OLT → ODC → splitter → ODP (bisa bertingkat). */
export default function TopologiDiagram({ olts, odcs, odps, splitters, links, feederPorts }) {
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [labels, setLabels] = useState(true);

  const graph = useMemo(
    () => buildTopologyGraph({ olts, odcs, odps, splitters, links, feederPorts }),
    [olts, odcs, odps, splitters, links, feederPorts],
  );

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
        </Card>
      )}
    </div>
  );
}
