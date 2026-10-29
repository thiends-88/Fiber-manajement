import { Link } from "react-router-dom";
import { interfaceLabel, interfaceLink } from "../lib/interfaces.js";

export default function InterfaceBadge({ port, link = false }) {
  const label = interfaceLabel(port);
  const cls = `inline-flex max-w-full break-all items-center rounded-md border px-2 py-1 text-xs font-medium ${port ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`;
  return link && port
    ? <Link className={`${cls} hover:underline`} to={interfaceLink(port)} title={`${port.olt_name || "OLT"} / ${port.interface_cli || label} — lihat jalur`}>{label}</Link>
    : <span className={cls} title={port?.interface_cli || label}>{label}</span>;
}
