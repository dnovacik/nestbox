// Reads the listed files and collects tagged comments. File contents stay in memory: only the matched
// lines' text is returned, for display; nothing is logged or stored.
import { open, stat } from 'node:fs/promises';
import type { Todo } from '@shared/tools/todos/contract';
import { resolveInside } from '../../fs/inside';
import { matchLine } from './match';

export const MAX_FILE_BYTES = 1024 * 1024;
const SNIFF_BYTES = 8 * 1024;

/** Never text worth scanning: images, fonts, archives, media, binaries, minified bundles and maps. */
const SKIP_FILE = /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|psd|svgz|woff2?|ttf|otf|eot|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|pdf|mp[34]|m4a|mov|avi|mkv|webm|wav|flac|ogg|exe|dll|so|dylib|node|wasm|class|pyc|db|sqlite3?|min\.js|min\.css|map)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i;

export interface ScanOptions {
  maxMatches?: number;
  timeLimitMs?: number;
  concurrency?: number;
  now?: () => number;
}

export interface ScanResult {
  todos: Todo[];
  /** Files actually read. */
  files: number;
  truncated: 'matches' | 'time' | null;
}

async function readText(abs: string): Promise<string | null> {
  const info = await stat(abs).catch(() => null);
  if (!info?.isFile() || info.size > MAX_FILE_BYTES) return null;
  const handle = await open(abs, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const buffer = await handle.readFile();
    if (buffer.subarray(0, SNIFF_BYTES).includes(0)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function scanFiles(dir: string, paths: readonly string[], tags: readonly string[], opts: ScanOptions = {}): Promise<ScanResult> {
  const maxMatches = opts.maxMatches ?? 5_000;
  const timeLimitMs = opts.timeLimitMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const started = now();
  const todos: Todo[] = [];
  let files = 0;
  let truncated: ScanResult['truncated'] = null;
  let next = 0;

  async function worker(): Promise<void> {
    while (truncated === null && next < paths.length) {
      if (now() - started > timeLimitMs) {
        truncated = 'time';
        return;
      }
      const path = paths[next++] ?? '';
      if (SKIP_FILE.test(path)) continue;
      let abs: string;
      try {
        abs = resolveInside(dir, path);
      } catch {
        continue;
      }
      const text = await readText(abs);
      if (text === null) continue;
      files++;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const match = matchLine(lines[i] ?? '', tags);
        if (!match) continue;
        if (todos.length >= maxMatches) {
          truncated = 'matches';
          return;
        }
        todos.push({ path, line: i + 1, ...match });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 16) }, worker));
  todos.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
  return { todos, files, truncated };
}
