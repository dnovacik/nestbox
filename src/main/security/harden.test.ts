import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { hardenAllWebContents, type WebContentsLike } from './harden';

type Handler = (event: { preventDefault(): void }, url: string) => void;

function fakeContents() {
  const handlers = new Map<string, Handler>();
  let openHandler: (() => { action: string }) | null = null;
  const contents: WebContentsLike = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
      return contents;
    },
    setWindowOpenHandler(handler) {
      openHandler = handler as () => { action: string };
    },
  } as WebContentsLike;
  const fire = (event: string, url = ''): boolean => {
    let prevented = false;
    handlers.get(event)?.({ preventDefault: () => (prevented = true) }, url);
    return prevented;
  };
  return { contents, fire, openWindow: () => openHandler?.() };
}

describe('hardenAllWebContents', () => {
  it('hardens every webContents as it is created', () => {
    const app = new EventEmitter();
    hardenAllWebContents(app, (url) => url.startsWith('http://localhost:5173/'));
    const { contents, fire, openWindow } = fakeContents();
    app.emit('web-contents-created', {}, contents);

    expect(fire('will-navigate', 'https://evil.example/')).toBe(true);
    expect(fire('will-navigate', 'http://localhost:5173/x')).toBe(false);
    expect(fire('will-redirect', 'https://evil.example/')).toBe(true);
    expect(fire('will-redirect', 'http://localhost:5173/')).toBe(false);
    expect(fire('will-attach-webview')).toBe(true);
    expect(openWindow()).toEqual({ action: 'deny' });
  });
});
