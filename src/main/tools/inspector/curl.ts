// "Copy as curl": a POSIX shell command that resends a recorded request to the API. It carries the real
// header values, so it only ever goes to the clipboard, on the user's click.
import { NestboxError } from '@shared/errors';
import { outboundUrl } from './proxy';
import { bodyView, type Entry } from './record';

const SKIP = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-connection',
]);

/** Single-quoted for sh/bash/zsh: a quote becomes '\''. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildCurl(entry: Entry, target: URL): string {
  const body = bodyView(entry.request);
  if (body.kind === 'binary')
    throw new NestboxError('VALIDATION', "A binary body can't be copied as curl");
  if (body.kind === 'text' && body.truncated)
    throw new NestboxError('VALIDATION', "The body was too large to keep, so it can't be copied");
  const parts = ['curl', '-X', entry.method, shellQuote(outboundUrl(target, entry.path).href)];
  for (const [name, value] of entry.request.headers) {
    if (SKIP.has(name.toLowerCase())) continue;
    parts.push('-H', shellQuote(`${name}: ${value}`));
  }
  if (body.kind === 'text') parts.push('--data-binary', shellQuote(body.text));
  return parts.join(' ');
}
