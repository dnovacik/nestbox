// .nestbox.json → canonical TeamContent. Each section is validated with the tools' own schemas; a failing
// section is dropped with a warning (section and index only, never values). The hash is over canonical JSON,
// so comments and formatting don't change it.
import { createHash } from 'node:crypto';
import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser';
import { z } from 'zod';
import { LABEL } from '@shared/domains';
import {
  EMPTY_CONTENT,
  MAX_TEAM_RUN_GROUPS,
  PackagePathSchema,
  TEAM_FILE_MAX_BYTES,
  type TeamContent,
  type TeamWarning,
} from '@shared/team-config';
import { StoredCheckSchema } from '@shared/tools/health/contract';
import { RouteSchema } from '@shared/tools/mock/contract';
import { CustomCommandSchema, EnvFileEntrySchema } from '@shared/tools/scripts/contract';
import { RunGroupSchema } from '@shared/types';

export type ParseResult =
  | { ok: true; content: TeamContent; warnings: TeamWarning[]; hash: string }
  | { ok: false; error: string };

const KNOWN = new Set([
  'version',
  'commands',
  'main',
  'envFiles',
  'hidden',
  'runGroups',
  'health',
  'mock',
  'domains',
]);
const Pkg = PackagePathSchema;

type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };
type ItemParser<T> = (item: unknown) => Checked<T>;

const fail = (error: z.ZodError): { ok: false; reason: string } => ({
  ok: false,
  reason: error.issues[0]?.message ?? 'invalid',
});

/** Validates the file's shape ("package" fields), maps it to the tool's shape, then validates that. Never throws. */
function itemParser<F, T>(
  fileShape: z.ZodType<F>,
  toTool: (f: F) => unknown,
  toolSchema: z.ZodType<T>,
): ItemParser<T> {
  return (item) => {
    const f = fileShape.safeParse(item);
    if (!f.success) return fail(f.error);
    const t = toolSchema.safeParse(toTool(f.data));
    return t.success ? { ok: true, value: t.data } : fail(t.error);
  };
}

const parseCommand = itemParser(
  z.object({ package: Pkg, name: z.string(), argv: z.array(z.string()) }),
  (c) => ({ relPath: c.package, name: c.name, argv: c.argv }),
  CustomCommandSchema,
);
const parseEnvFile = itemParser(
  z.object({ package: Pkg, name: z.string(), file: z.string().nullable() }),
  (e) => ({ relPath: e.package, script: e.name, file: e.file }),
  EnvFileEntrySchema,
);
const parseRunGroup = itemParser(
  z.object({
    name: z.string(),
    entries: z.array(z.object({ package: Pkg, script: z.string() })),
    compose: z.array(z.object({ package: Pkg, services: z.array(z.string()) })).default([]),
  }),
  (g) => ({
    name: g.name,
    entries: g.entries.map((e) => ({ relPath: e.package, script: e.script })),
    compose: g.compose.map((c) => ({ relPath: c.package, services: c.services })),
  }),
  RunGroupSchema,
);

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export const contentHash = (content: TeamContent) =>
  createHash('sha256').update(canonicalJson(content)).digest('hex');

const MAX_DEPTH = 64;
const MAX_UNKNOWN_WARNINGS = 10;

/** True when brackets nest deeper than MAX_DEPTH (strings and comments skipped); jsonc-parser recurses unguarded. */
function nestedTooDeep(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
    } else if (c === '[' || c === '{') {
      if (++depth > MAX_DEPTH) return true;
    } else if (c === ']' || c === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return false;
}

/** Own properties only: jsonc-parser assigns "__proto__" as a prototype, not a key. */
const own = (obj: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(obj, key) ? obj[key] : undefined;

function lineColumn(text: string, offset: number): string {
  const before = text.slice(0, offset).split(/\r\n|\r|\n/);
  return `Line ${before.length}, column ${(before.at(-1)?.length ?? 0) + 1}`;
}

/** Validates an array section item by item; the whole section is dropped on any failure (spec §1). */
function arraySection<T>(
  raw: unknown,
  parseItem: ItemParser<T>,
  max: number,
  section: string,
  warnings: TeamWarning[],
): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push({ section, index: null, reason: 'not a list' });
    return [];
  }
  if (raw.length > max) {
    warnings.push({ section, index: null, reason: `more than ${max} items` });
    return [];
  }
  const out: T[] = [];
  for (const [index, item] of raw.entries()) {
    const r = parseItem(item);
    if (!r.ok) {
      warnings.push({ section, index, reason: r.reason });
      return [];
    }
    out.push(r.value);
  }
  return out;
}

function recordSection<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  section: string,
  warnings: TeamWarning[],
): Record<string, T> {
  if (raw === undefined) return {};
  const r = z.record(Pkg, schema).safeParse(raw);
  if (r.success) return r.data;
  warnings.push({ section, index: null, reason: r.error.issues[0]?.message ?? 'invalid' });
  return {};
}

export function parseTeamFile(text: string): ParseResult {
  if (Buffer.byteLength(text, 'utf8') > TEAM_FILE_MAX_BYTES)
    return { ok: false, error: 'The file is larger than 256 KiB' };
  if (nestedTooDeep(text)) return { ok: false, error: 'The file is nested too deeply' };
  const errors: ParseError[] = [];
  let root: unknown;
  try {
    root = parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, errors, {
      allowTrailingComma: true,
    });
  } catch {
    return { ok: false, error: "The file can't be read" };
  }
  const first = errors[0];
  if (first)
    return {
      ok: false,
      error: `${lineColumn(text, first.offset)}: ${printParseErrorCode(first.error)}`,
    };
  if (!root || typeof root !== 'object' || Array.isArray(root))
    return { ok: false, error: 'The file is not a JSON object' };
  const file = root as Record<string, unknown>;
  if (own(file, 'version') !== 1)
    return {
      ok: false,
      error: `Made by a newer NestBox (version ${String(own(file, 'version'))})`,
    };

  const warnings: TeamWarning[] = [];
  const unknownKeys = Object.keys(file).filter((k) => !KNOWN.has(k));
  for (const key of unknownKeys.slice(0, MAX_UNKNOWN_WARNINGS))
    warnings.push({
      section: key.length > 40 ? `${key.slice(0, 40)}…` : key,
      index: null,
      reason: 'unknown section',
    });
  if (unknownKeys.length > MAX_UNKNOWN_WARNINGS)
    warnings.push({
      section: 'unknown',
      index: null,
      reason: `${unknownKeys.length - MAX_UNKNOWN_WARNINGS} more unknown sections`,
    });
  const rawDomains = own(file, 'domains');
  const domains: Record<string, unknown> =
    rawDomains && typeof rawDomains === 'object' && !Array.isArray(rawDomains)
      ? (rawDomains as Record<string, unknown>)
      : {};
  if (rawDomains !== undefined && domains !== rawDomains)
    warnings.push({ section: 'domains', index: null, reason: 'not an object' });
  const health = recordSection(
    own(file, 'health'),
    z.object({
      intervalSec: z.number().int().min(5).max(600).nullable().default(null),
      checks: z.array(StoredCheckSchema).max(20).default([]),
    }),
    'health',
    warnings,
  );
  const content: TeamContent = {
    ...EMPTY_CONTENT,
    commands: arraySection(own(file, 'commands'), parseCommand, 100, 'commands', warnings),
    envFiles: arraySection(own(file, 'envFiles'), parseEnvFile, 500, 'envFiles', warnings),
    runGroups: arraySection(
      own(file, 'runGroups'),
      parseRunGroup,
      MAX_TEAM_RUN_GROUPS,
      'runGroups',
      warnings,
    ),
    main: recordSection(own(file, 'main'), z.string().min(1).max(60), 'main', warnings),
    hidden: recordSection(
      own(file, 'hidden'),
      z.array(z.string().min(1).max(200)).max(100),
      'hidden',
      warnings,
    ),
    health,
    mock: recordSection(
      own(file, 'mock'),
      z.object({ routes: z.array(RouteSchema).max(100).default([]) }),
      'mock',
      warnings,
    ),
    domainNames: recordSection(
      own(domains, 'names'),
      z.string().regex(LABEL),
      'domains.names',
      warnings,
    ),
    rewriteHost: recordSection(
      own(domains, 'rewriteHost'),
      z.literal(true),
      'domains.rewriteHost',
      warnings,
    ),
  };
  return { ok: true, content, warnings, hash: contentHash(content) };
}
