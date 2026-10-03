// Listening sockets as the platform parsers produce them, and the grouping both platforms share.

export interface ListeningSocket {
  port: number;
  address: string;
  pid: number;
}

export interface GroupedSocket {
  port: number;
  pid: number;
  addresses: string[];
}

/** One entry per (port, PID) with every address it listens on, sorted by port, then PID. */
export function groupSockets(sockets: readonly ListeningSocket[]): GroupedSocket[] {
  const byKey = new Map<string, GroupedSocket>();
  for (const s of sockets) {
    const key = `${s.port}:${s.pid}`;
    const entry = byKey.get(key) ?? { port: s.port, pid: s.pid, addresses: [] };
    if (!entry.addresses.includes(s.address)) entry.addresses.push(s.address);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}
