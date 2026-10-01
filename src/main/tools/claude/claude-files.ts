// Reads Claude Code's project files. Their layout changes between Claude Code versions, so everything
// here is defensive: a file that can't be parsed is named in `unreadable`, never thrown.
// MCP server arguments, env and URL paths/queries can hold tokens: they are never put in the result.
import type { Dirent } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isRecord } from '@shared/is-record';

/** Most entries listed per kind; a .claude folder with more is unusual. */
const MAX_ITEMS = 200;
/** Front matter lives at the top: never read more of a Markdown file than this. */
const HEAD_BYTES = 8 * 1024;
const MAX_JSON_BYTES = 512 * 1024;

export interface NamedEntry {
  name: string;
  description: string | null;
}

export interface SettingsSummary {
  file: string;
  allow: string[];
  deny: string[];
  ask: string[];
  /** Hook event names (PostToolUse, Stop, …). */
  hooks: string[];
}

export interface McpServerSummary {
  name: string;
  type: string;
  command: string | null;
  argCount: number;
  /** Origin only (scheme and host), for http/sse servers. */
  url: string | null;
}

export interface ClaudeFiles {
  claudeMd: boolean;
  claudeLocalMd: boolean;
  commands: NamedEntry[];
  agents: NamedEntry[];
  skills: NamedEntry[];
  settings: SettingsSummary[];
  mcpServers: McpServerSummary[];
  /** Project-relative names of files that exist but couldn't be parsed. */
  unreadable: string[];
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false;
}

async function readHead(path: string): Promise<string | null> {
  const handle = await open(path, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** The YAML front matter of a Markdown file; null when it has none, 'invalid' when it doesn't parse. */
function frontMatter(text: string): Record<string, unknown> | null | 'invalid' {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  try {
    const doc: unknown = parseYaml(match[1] ?? '');
    return isRecord(doc) ? doc : null;
  } catch {
    return 'invalid';
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

async function readEntry(path: string, fallbackName: string, label: string, unreadable: string[]): Promise<NamedEntry> {
  const head = await readHead(path);
  const meta = head === null ? null : frontMatter(head);
  if (meta === 'invalid') {
    unreadable.push(label);
    return { name: fallbackName, description: null };
  }
  return { name: str(meta?.['name']) ?? fallbackName, description: str(meta?.['description']) };
}

async function listDir(path: string): Promise<Dirent[]> {
  return readdir(path, { withFileTypes: true }).catch(() => []);
}

async function readCommands(root: string, dir: string, unreadable: string[], out: NamedEntry[]): Promise<void> {
  for (const entry of (await listDir(dir)).sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_ITEMS) return;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await readCommands(root, path, unreadable, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Claude Code names nested commands with ':' (frontend/component.md → frontend:component).
      const name = relative(root, path).replace(/\.md$/, '').split(/[\\/]/).join(':');
      const label = `.claude/commands/${relative(root, path).split(/[\\/]/).join('/')}`;
      const meta = await readEntry(path, name, label, unreadable);
      out.push({ name, description: meta.description });
    }
  }
}

async function readJson(path: string, label: string, unreadable: string[]): Promise<Record<string, unknown> | null> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  if (info.size > MAX_JSON_BYTES) {
    unreadable.push(label);
    return null;
  }
  try {
    const doc: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (isRecord(doc)) return doc;
  } catch {
    // reported below
  }
  unreadable.push(label);
  return null;
}

function originOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export async function readClaudeFiles(dir: string): Promise<ClaudeFiles> {
  const unreadable: string[] = [];
  const claude = join(dir, '.claude');

  const commands: NamedEntry[] = [];
  const commandsDir = join(claude, 'commands');
  await readCommands(commandsDir, commandsDir, unreadable, commands);

  const agents: NamedEntry[] = [];
  for (const entry of (await listDir(join(claude, 'agents'))).sort((a, b) => a.name.localeCompare(b.name))) {
    if (agents.length >= MAX_ITEMS || !entry.isFile() || !entry.name.endsWith('.md')) continue;
    agents.push(await readEntry(join(claude, 'agents', entry.name), entry.name.replace(/\.md$/, ''), `.claude/agents/${entry.name}`, unreadable));
  }

  const skills: NamedEntry[] = [];
  for (const entry of (await listDir(join(claude, 'skills'))).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(claude, 'skills', entry.name, 'SKILL.md');
    if (skills.length >= MAX_ITEMS || !entry.isDirectory() || !(await isFile(file))) continue;
    skills.push(await readEntry(file, entry.name, `.claude/skills/${entry.name}/SKILL.md`, unreadable));
  }

  const settings: SettingsSummary[] = [];
  for (const name of ['settings.json', 'settings.local.json']) {
    const label = `.claude/${name}`;
    const doc = await readJson(join(claude, name), label, unreadable);
    if (!doc) continue;
    const permissions = isRecord(doc['permissions']) ? doc['permissions'] : {};
    settings.push({
      file: label,
      allow: strings(permissions['allow']),
      deny: strings(permissions['deny']),
      ask: strings(permissions['ask']),
      hooks: isRecord(doc['hooks']) ? Object.keys(doc['hooks']) : [],
    });
  }

  const mcpServers: McpServerSummary[] = [];
  const mcp = await readJson(join(dir, '.mcp.json'), '.mcp.json', unreadable);
  if (mcp && isRecord(mcp['mcpServers'])) {
    for (const [name, raw] of Object.entries(mcp['mcpServers']).slice(0, MAX_ITEMS)) {
      if (!isRecord(raw)) continue;
      const url = originOf(raw['url']);
      mcpServers.push({
        name,
        type: str(raw['type']) ?? (url ? 'http' : 'stdio'),
        command: str(raw['command']),
        argCount: Array.isArray(raw['args']) ? raw['args'].length : 0,
        url,
      });
    }
  }

  return {
    claudeMd: await isFile(join(dir, 'CLAUDE.md')),
    claudeLocalMd: await isFile(join(dir, 'CLAUDE.local.md')),
    commands,
    agents,
    skills,
    settings,
    mcpServers,
    unreadable,
  };
}
