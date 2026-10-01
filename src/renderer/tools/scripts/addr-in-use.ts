import type { LogLine } from '@shared/processes';
import { stripAnsi } from '@shared/ansi-strip';

/** NestBox's own start marker (see ProcessManager): "▸ pnpm run dev". */
const START_MARKER = '▸ ';

/** Node: "listen EADDRINUSE: address already in use :::3000" (also 0.0.0.0:3000, [::1]:3000): the last ":<port>". */
function nodePort(text: string): number | null {
  const after = text.slice(text.indexOf('EADDRINUSE'));
  const matches = [...after.matchAll(/[\]:](\d{1,5})(?![\d\]:.])/g)];
  const port = Number(matches.at(-1)?.[1]);
  return Number.isInteger(port) ? port : null;
}

const PATTERNS = [
  // Vite and friends: "Port 5173 is already in use"
  /\bport (\d{1,5}) is already in use/i,
  // pino-style JSON errors: {"code":"EADDRINUSE","port":3000}
  /"code":"EADDRINUSE".*?"port":(\d{1,5})/,
];

function portIn(text: string): number | null {
  const plain = stripAnsi(text);
  if (!/EADDRINUSE|already in use/i.test(plain)) return null;
  const candidates = [...PATTERNS.map((p) => Number(p.exec(plain)?.[1])), plain.includes('EADDRINUSE') ? nodePort(plain) : null];
  return candidates.find((port): port is number => Number.isInteger(port) && port !== null && port >= 1 && port <= 65_535) ?? null;
}

/** The port of the last "address in use" error since the script's last start, or null. */
export function addrInUsePort(lines: readonly LogLine[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    if (line.stream === 'system' && line.text.startsWith(START_MARKER)) return null;
    const port = portIn(line.text);
    if (port !== null) return port;
  }
  return null;
}
