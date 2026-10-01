// Parsers for the Windows commands behind listListeningPorts. Pure, so they are tested on captured output.

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

/** `1.2.3.4:80` or `[::1]:80` → { address, port }. */
function splitEndpoint(endpoint: string): { address: string; port: number } | null {
  const match = /^\[(.+)\]:(\d+)$/.exec(endpoint) ?? /^([^:\s]+):(\d+)$/.exec(endpoint);
  if (!match?.[1] || !match[2]) return null;
  const port = Number(match[2]);
  return port >= 0 && port <= 65_535 ? { address: match[1], port } : null;
}

/**
 * Listening rows of `netstat -ano -p TCP` or `-p TCPv6`. The state column is localised (LISTENING,
 * ABHÖREN, …), so a row counts as listening when its foreign address is the unspecified 0.0.0.0:0 or [::]:0.
 */
export function parseNetstat(text: string): ListeningSocket[] {
  const sockets: ListeningSocket[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== 'TCP' || cols.length < 5) continue;
    const local = splitEndpoint(cols[1] ?? '');
    const foreign = cols[2];
    const pid = Number(cols[cols.length - 1]);
    if (!local || !Number.isInteger(pid) || (foreign !== '0.0.0.0:0' && foreign !== '[::]:0')) continue;
    sockets.push({ port: local.port, address: local.address, pid });
  }
  return sockets;
}

/** Splits one CSV line with double-quoted fields ("a","b, c"). */
function csvFields(line: string): string[] | null {
  const fields: string[] = [];
  const re = /"((?:[^"]|"")*)"(?:,|$)/y;
  let index = 0;
  while (index < line.length) {
    re.lastIndex = index;
    const match = re.exec(line);
    if (!match) return null;
    fields.push((match[1] ?? '').replace(/""/g, '"'));
    index = re.lastIndex;
  }
  return fields;
}

/** `tasklist /FO CSV /NH` → PID → image name. */
export function parseTasklist(text: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const fields = line.startsWith('"') ? csvFields(line.trim()) : null;
    const name = fields?.[0];
    const pid = Number(fields?.[1]);
    if (name && Number.isInteger(pid)) names.set(pid, name);
  }
  return names;
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
