// appsettings*.json as .NET reads it: JSON with comments and trailing commas, flattened into configuration
// paths (`Logging:LogLevel:Default`, arrays by index). Edits go through jsonc-parser's modify, so only the
// edited value changes: comments, order, indentation, line endings and a BOM stay as they were.
// Messages never contain keys or values.
import { applyEdits, modify, parseTree, type FormattingOptions, type Node, type ParseError } from 'jsonc-parser';
import { NestboxError } from '@shared/errors';
import { JSON_NUMBER, type ConfigType, type EditableConfigType } from '@shared/tools/env/contract';

export const MAX_CONFIG_KEYS = 2000;
const BOM = '﻿';

export interface ConfigLeaf {
  /** The configuration path, in the file's casing. */
  key: string;
  /** The JSON path to the value (property names as written, array indexes). */
  path: (string | number)[];
  type: ConfigType;
  /** "", null, {} or []. */
  empty: boolean;
  /** Where the value's source text is (in the text without its BOM). */
  offset: number;
  length: number;
}

const stripBom = (text: string) => (text.startsWith(BOM) ? text.slice(1) : text);

function tree(text: string): Node | null {
  const errors: ParseError[] = [];
  const root = parseTree(stripBom(text), errors, { allowTrailingComma: true, disallowComments: false });
  return errors.length === 0 && root?.type === 'object' ? root : null;
}

function requireTree(text: string): Node {
  const root = tree(text);
  if (!root) throw new NestboxError('VALIDATION', 'The settings file is not valid JSON');
  return root;
}

/** Property nodes' [name, value] pairs. */
function properties(node: Node): { name: string; value: Node }[] {
  const out: { name: string; value: Node }[] = [];
  for (const p of node.children ?? []) {
    const [name, value] = p.children ?? [];
    if (name && value && typeof name.value === 'string') out.push({ name: name.value, value });
  }
  return out;
}

/** Every leaf: scalars and empty containers. null when the text isn't JSONC with an object at the root. */
export function parseConfig(text: string): ConfigLeaf[] | null {
  const root = tree(text);
  if (!root) return null;
  const leaves: ConfigLeaf[] = [];
  const visit = (node: Node, key: string, path: (string | number)[]) => {
    const children =
      node.type === 'object'
        ? properties(node).map((p) => ({ seg: p.name as string | number, node: p.value }))
        : node.type === 'array'
          ? (node.children ?? []).map((child, i) => ({ seg: i as string | number, node: child }))
          : null;
    if (children && children.length > 0) {
      for (const c of children) visit(c.node, key === '' ? String(c.seg) : `${key}:${c.seg}`, [...path, c.seg]);
      return;
    }
    const type = node.type as ConfigType;
    leaves.push({
      key,
      path,
      type,
      empty: children !== null || node.value === null || node.value === '',
      offset: node.offset,
      length: node.length,
    });
  };
  for (const p of properties(root)) visit(p.value, p.name, [p.name]);
  return leaves;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** .NET matches keys case-insensitively, and the last one wins. */
export function findLeaf(leaves: readonly ConfigLeaf[], key: string): ConfigLeaf | undefined {
  return leaves.findLast((l) => same(l.key, key));
}

/** Keys that appear more than once when case is ignored (the first spelling of each). */
export function caseDuplicates(leaves: readonly ConfigLeaf[]): string[] {
  const seen = new Map<string, { key: string; count: number }>();
  for (const l of leaves) {
    const k = l.key.toLowerCase();
    const entry = seen.get(k) ?? { key: l.key, count: 0 };
    entry.count++;
    seen.set(k, entry);
  }
  return [...seen.values()].filter((e) => e.count > 1).map((e) => e.key);
}

/** The value as the user sees it: a string as is, anything else as its JSON source text. */
export function leafValue(text: string, leaf: ConfigLeaf): string {
  const source = stripBom(text).slice(leaf.offset, leaf.offset + leaf.length);
  return leaf.type === 'string' ? (JSON.parse(source) as string) : source;
}

/** Typed input as the JSON value to write. */
export function toJsonValue(value: string, type: EditableConfigType): string | number | boolean | null {
  switch (type) {
    case 'string':
      return value;
    case 'null':
      return null;
    case 'boolean':
      if (value.trim() === 'true') return true;
      if (value.trim() === 'false') return false;
      throw new NestboxError('VALIDATION', 'Not true or false');
    case 'number': {
      const n = Number(value.trim());
      if (!JSON_NUMBER.test(value.trim()) || !Number.isFinite(n)) throw new NestboxError('VALIDATION', 'Not a number');
      return n;
    }
  }
}

/** Line ending and indentation as the file already has them (two spaces for a new or flat file). */
function formatting(text: string): FormattingOptions {
  const indent = /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';
  const tabs = indent.startsWith('\t');
  return { insertSpaces: !tabs, tabSize: tabs ? 1 : indent.length, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

function edit(text: string, path: (string | number)[], value: unknown): string {
  const bom = text.startsWith(BOM) ? BOM : '';
  const body = stripBom(text);
  return bom + applyEdits(body, modify(body, path, value, { formattingOptions: formatting(body) }));
}

function existing(text: string, key: string): ConfigLeaf {
  const leaves = parseConfig(text);
  if (!leaves) throw new NestboxError('VALIDATION', 'The settings file is not valid JSON');
  const leaf = findLeaf(leaves, key);
  if (!leaf) throw new NestboxError('NOT_FOUND', 'That key is not in this file');
  return leaf;
}

export function setConfigValue(text: string, key: string, value: unknown): string {
  return edit(text, existing(text, key).path, value);
}

export function removeConfigKey(text: string, key: string): string {
  return edit(text, existing(text, key).path, undefined);
}

/**
 * A new key: existing parents are matched case-insensitively (in their casing), missing ones are created
 * as objects, and an array takes a new item only at its end.
 */
export function addConfigKey(text: string, key: string, value: unknown): string {
  const segments = key.split(':');
  let node: Node | undefined = requireTree(text);
  const path: (string | number)[] = [];
  for (const [i, seg] of segments.entries()) {
    if (node === undefined) {
      path.push(seg);
    } else if (node.type === 'object') {
      const prop = properties(node).findLast((p) => same(p.name, seg));
      path.push(prop ? prop.name : seg);
      node = prop?.value;
    } else if (node.type === 'array') {
      const items = node.children ?? [];
      if (!/^\d+$/.test(seg)) throw new NestboxError('VALIDATION', 'Array items are numbered from 0');
      const index = Number(seg);
      if (index > items.length) throw new NestboxError('VALIDATION', 'Add array items in order, at the end');
      if (index === items.length && i < segments.length - 1)
        throw new NestboxError('VALIDATION', 'Add the array item first');
      path.push(index === items.length ? -1 : index);
      node = items[index];
    } else {
      throw new NestboxError('CONFLICT', 'A parent of that key holds a value');
    }
  }
  if (node !== undefined) throw new NestboxError('CONFLICT', 'That key is already in this file');
  return edit(text, path, value);
}

const STANDARD = ['development', 'staging', 'production'];

/** Columns: appsettings.json, then Development, Staging, Production, then the rest (alphabetically). */
export function configColumnRank(name: string): number {
  const env = /^appsettings\.(.+)\.json$/.exec(name)?.[1]?.toLowerCase();
  if (env === undefined) return 0;
  const standard = STANDARD.indexOf(env);
  return standard === -1 ? STANDARD.length + 1 : standard + 1;
}

/** The text must be JSONC with an object at the root (raw saves). */
export function assertConfigText(text: string): void {
  requireTree(text);
}
