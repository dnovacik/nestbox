import type { Session, WebContents } from 'electron';

export function hardenWebContents(contents: WebContents, isAllowedUrl: (url: string) => boolean): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

export function applySessionSecurity(session: Session, opts: { devCsp?: string }): void {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  if (opts.devCsp) {
    const csp = opts.devCsp;
    // Production CSP is a <meta> tag injected at build time; dev needs it as a header.
    session.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  }
}
