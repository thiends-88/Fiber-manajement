import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { buildInterfaceRoutes } from "../lib/interface-routes.js";
import { loadNetworkData } from "../lib/network-data.js";
import { interfaceLink } from "../lib/interfaces.js";
import { Card } from "./ui.jsx";
import InterfaceBadge from "./InterfaceBadge.jsx";

export default function OdpInterfaceOrigins({ odpId, odpName, reloadKey }) {
  const [state, setState] = useState({ loading: true });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    loadNetworkData().then((data) => {
      if (active) setState({ origins: buildInterfaceRoutes(data).odpOrigins.get(Number(odpId)) || [] });
    }).catch((e) => { if (active) setState({ error: e.message }); });
    return () => { active = false; };
  }, [odpId, reload, reloadKey]);
  return <Card className="mt-5">
    <h2 className="mb-2 text-sm font-semibold">Asal interface OLT — {odpName}</h2>
    {state.loading ? <p className="text-xs text-mut">Menelusuri sambungan ke hulu…</p> : state.error ? <div role="alert"><p className="text-xs text-red-400">{state.error}</p><button className="btn mt-2 text-xs" onClick={() => setReload((n) => n + 1)}>Coba lagi</button></div> : state.origins.length ? <div className="space-y-3">{state.origins.map((origin, i) => <div key={`${origin.groupId}-${i}`} className="rounded-lg border border-line bg-panel2 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold">{origin.olt?.name || "OLT belum diketahui"}</span><InterfaceBadge port={origin.port} /><span className="text-mut">Jalur {i + 1}</span>{origin.port && <Link className="ml-auto text-acc underline" to={interfaceLink(origin.port)}>Lihat seluruh cabang interface →</Link>}</div>
      <p className="mt-2 break-words text-xs leading-relaxed text-mut">{origin.text}</p>
      {!origin.port && <p className="mt-2 text-xs text-amber-300">{origin.inputConflict ? "Core feeder memiliki input ganda. Periksa sambungan di Mapping Core; sumber belum dapat dikonfirmasi." : "Sambungan hilir sudah tercatat, tetapi interface asal belum dipetakan. Jangan menyimpulkannya hanya dari ODC induk."}</p>}
    </div>)}</div> : <p className="text-xs text-mut">Interface asal belum diketahui karena belum ada sambungan menuju ODP ini. Catat output splitter atau sambungan kabel langsung di <Link className="text-acc underline" to="/mapping">Mapping Core</Link>.</p>}
  </Card>;
}
