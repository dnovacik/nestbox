// Where a Node package's dev server listens: a port its dev or start script names, else its framework's
// default. Names and numbers only: script text never leaves detection.
import type { Framework, FrameworkId } from './framework';

/** The dev servers' own defaults; frameworks without one (Electron, Express) have none. */
const DEFAULT_PORTS: Partial<Record<FrameworkId, number>> = {
  next: 3000,
  nuxt: 3000,
  remix: 5173,
  astro: 4321,
  sveltekit: 5173,
  nestjs: 3000,
  vite: 5173,
};

/** The scripts that start the app; a test or lint script's port isn't where it listens. */
const SERVER_SCRIPTS = ['dev', 'start'];

/** `--port 3001`, `--port=3001`, `-p 3001`, `PORT=3001`: whole words, so `-p tsconfig.json` doesn't match. */
const PORT_PATTERNS = [
  /(?:^|\s)--port[=\s]+(\d{1,5})(?=\s|$)/g,
  /(?:^|\s)-p\s+(\d{1,5})(?=\s|$)/g,
  /(?:^|\s)PORT=(\d{1,5})(?=\s|$)/g,
];

function scriptPorts(script: string): number[] {
  const found: { at: number; port: number }[] = [];
  for (const pattern of PORT_PATTERNS) {
    for (const match of script.matchAll(pattern)) {
      const port = Number(match[1]);
      if (port >= 1 && port <= 65_535) found.push({ at: match.index, port });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.port);
}

/** Explicit ports from the dev and start scripts in order, then the framework's default; no duplicates. */
export function nodePorts(
  scripts: Readonly<Record<string, string>>,
  framework: Framework | null,
): number[] {
  const ports: number[] = [];
  const add = (port: number) => {
    if (!ports.includes(port)) ports.push(port);
  };
  for (const name of SERVER_SCRIPTS) {
    const script = scripts[name];
    if (typeof script === 'string') scriptPorts(script).forEach(add);
  }
  const fallback = framework ? DEFAULT_PORTS[framework.id] : undefined;
  if (fallback !== undefined) add(fallback);
  return ports;
}
