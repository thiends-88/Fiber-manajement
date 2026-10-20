import { api } from "./api.js";

export async function loadNetworkData() {
  const names = ["olts", "ports", "odcs", "odps", "links", "feederPorts", "splitters", "cores", "interfaceMappings"];
  const paths = ["olts", "ports", "odcs", "odps", "links", "feeder-ports", "splitters", "cores", "interface-mappings"];
  const values = await Promise.all(paths.map((p) => api(`/api/${p}`)));
  return Object.fromEntries(names.map((name, i) => [name, values[i]]));
}
