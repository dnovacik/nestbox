// The small pages the domains proxy answers itself. They never echo the request (paths, headers).
const STYLE =
  'body{font:14px system-ui,sans-serif;background:rgb(16,18,22);color:rgb(226,230,236);margin:48px}' +
  'h1{font-size:18px}code{background:rgb(32,36,44);padding:1px 4px;border-radius:4px}' +
  '@media (prefers-color-scheme: light){body{background:rgb(250,250,250);color:rgb(24,24,27)}code{background:rgb(235,235,240)}}';

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>${STYLE}</style></head><body><h1>${escape(title)}</h1>${body}<p>NestBox local domains</p></body></html>`;
}

export const forbiddenPage = () =>
  page('Not a NestBox domain', '<p>NestBox only answers names under <code>.localhost</code>.</p>');

export const unknownPage = (known: readonly string[]) =>
  page(
    'Unknown name',
    known.length === 0
      ? '<p>No project has a local domain yet.</p>'
      : `<p>Known names:</p><ul>${known.map((n) => `<li><code>${escape(n)}</code></li>`).join('')}</ul>`,
  );

export const notRunningPage = (name: string) =>
  page(`${name} isn't running`, '<p>Start its main command in NestBox, then reload this page.</p>');

export const badGatewayPage = (name: string, port: number) =>
  page(
    `${name} isn't answering`,
    `<p>Nothing accepted the connection on port <code>${port}</code>.</p>`,
  );
