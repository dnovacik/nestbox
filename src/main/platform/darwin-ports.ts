// Parser for `lsof -nP -iTCP -sTCP:LISTEN +c 0 -F pcftn`, behind listListeningPorts on macOS. Field output:
// one field per line, the first letter names it (p = PID, c = command, f = descriptor, t = IPv4/IPv6,
// n = address). Pure, so it is tested on captured output.
import type { ListeningSocket } from './sockets';

/** `127.0.0.1:5432`, `[::1]:5173` or `*:3000` (any address: 0.0.0.0 or :: by the socket's type). */
function endpoint(name: string, type: string | null): { address: string; port: number } | null {
  const match = /^\[(.+)\]:(\d+)$/.exec(name) ?? /^([^:\s]+):(\d+)$/.exec(name);
  if (!match?.[1] || !match[2]) return null;
  const port = Number(match[2]);
  if (!(port >= 0 && port <= 65_535)) return null;
  const address = match[1] === '*' ? (type === 'IPv6' ? '::' : '0.0.0.0') : match[1];
  return { address, port };
}

export function parseLsof(text: string): { sockets: ListeningSocket[]; names: Map<number, string> } {
  const sockets: ListeningSocket[] = [];
  const names = new Map<number, string>();
  let pid: number | null = null;
  let type: string | null = null;
  for (const line of text.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      pid = /^\d+$/.test(value) ? Number(value) : null;
      type = null;
    } else if (pid === null) {
      continue;
    } else if (field === 'c' && value !== '') {
      names.set(pid, value);
    } else if (field === 'f') {
      type = null;
    } else if (field === 't') {
      type = value;
    } else if (field === 'n') {
      const parsed = endpoint(value, type);
      if (parsed) sockets.push({ pid, ...parsed });
    }
  }
  return { sockets, names };
}
