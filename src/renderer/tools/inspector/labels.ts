/** "localhost:3000" from "http://localhost:3000". */
export const shortUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function statusTone(status: number | null): string {
  if (status === null) return 'text-err';
  if (status >= 500) return 'text-err';
  if (status >= 400) return 'text-warn';
  if (status >= 300) return 'text-fg-muted';
  return 'text-ok';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour12: false });
}

/** JSON pretty-printed when it parses; the text as it is otherwise. */
export function prettyBody(text: string, contentType: string | null): string {
  if (contentType !== null && !/json/i.test(contentType)) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
