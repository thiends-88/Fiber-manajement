import { useEffect, useLayoutEffect, useState } from "react";
import { api, getSessionVersion } from "../lib/api.js";
import { validateOdpSnapshot } from "../lib/map-snapshot.js";
import { buildOdpConnections, summarizeOdpConnections } from "../lib/odp-connections.js";

// Popup singkat saat ikon dibuka. Rincian panjang tetap opsional di sidebar.
export default function OdpMapPopup({ node, onResize }) {
  const [state, setState] = useState({ loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const session = getSessionVersion();
    setState({ loading: true });
    api(`/api/map-data?odp_id=${encodeURIComponent(node.id)}`).then(value => {
      if (!active || session !== getSessionVersion()) return;
      const snapshot = validateOdpSnapshot(value, node.id);
      const detail = buildOdpConnections({ ...snapshot, cores: snapshot.odpDetail.cores }, node.id);
      if (active && session === getSessionVersion()) setState({ summary: summarizeOdpConnections(detail) });
    }).catch(error => {
      if (active && session === getSessionVersion()) setState({ error });
    });
    return () => { active = false; };
  }, [node.id, revision]);
  useLayoutEffect(() => { onResize?.(); }, [state, onResize]);
  const summary = state.summary;
  return <div className="odp-popup-summary" data-odp-popup={node.id} aria-busy={!!state.loading}>
    <strong className="odp-popup-name">{summary?.name || node.name}</strong>
    {state.loading && <p className="odp-popup-muted" role="status">Memuat sambungan…</p>}
    {state.error && <div role="alert">
      <p className="odp-popup-muted" title={state.error.message}>{state.error.status === 404 ? "ODP tidak ditemukan." : "Sambungan belum dapat dimuat."}</p>
      <button className="btn text-xs" onClick={() => { setState({ loading: true }); setRevision(n => n + 1); }}>Coba lagi</button>
    </div>}
    {summary && <>
      <div className="odp-popup-cores" aria-label="Core power ODP">
        <span className="odp-popup-muted">Core power</span>
        {!summary.cores.length && <span className="odp-popup-muted">belum ditandai</span>}
        {summary.cores.map(core => {
          const label = `Core ${core.number} · ${core.color} · Tube ${core.tube} · ${core.records.some(r => r.status === "used") ? "tercatat terpakai" : "terdeteksi dari sambungan"}`;
          return <span key={core.number} className="odp-popup-core" role="img" aria-label={label} title={label} data-odp-popup-core={core.number}>
            <span className="odp-popup-core-dot" style={{ backgroundColor: core.hex }} aria-hidden="true" />
            <span aria-hidden="true">C{core.number}</span>
          </span>;
        })}
      </div>
      <div className="odp-popup-sources" aria-label="Interface dan ODC asal">
        {summary.sources.map(source => <p key={source.key} data-odp-popup-source title={source.oltName ? `${source.oltName} · ${source.interface}` : undefined}>
          {source.interface}{source.odcName && <> — {source.odcName}</>}
        </p>)}
      </div>
      {summary.notice && <p className="odp-popup-warning">{summary.notice}</p>}
    </>}
  </div>;
}
