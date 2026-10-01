import type { Session, WebContents } from 'electron';

/** The parts of WebContents that hardening touches; structural so it can be tested without Electron. */
export type WebContentsLike = Pick<WebContents, 'on' | 'setWindowOpenHandler'>;

interface AppLike {
  on(event: 'web-contents-created', listener: (event: unknown, contents: WebContentsLike) => void): unknown;
}

/** Applies hardenWebContents to every webContents the app creates, not only the main window's. */
export function hardenAllWebContents(app: AppLike, isAllowedUrl: (url: string) => boolean): void {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, isAllowedUrl));
}

export function hardenWebContents(contents: WebContentsLike, isAllowedUrl: (url: string) => boolean): void {
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
