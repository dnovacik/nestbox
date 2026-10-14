// The local domains proxy: HTTP and HTTPS servers on loopback that stream each request to the port its
// Host routes to. Nothing is recorded; the route table is read per request. Logs carry names, ports and codes.
import {
  createServer as createHttpServer,
  type IncomingMessage,
  request,
  type Server,
  type ServerResponse,
} from 'node:http';
import { connect, type Socket } from 'node:net';
import { pipeline, type Duplex } from 'node:stream';
import { createServer as createHttpsServer } from 'node:https';
import { createSecureContext, type SecureContext } from 'node:tls';
import type { ServerState } from '@shared/domains';
import type { Logger } from '../logger';
import { proxyRequestHeaders } from '../net/forward';
import { badGatewayPage, forbiddenPage, notRunningPage, unknownPage } from './pages';
import { resolveHost, type RouteTable } from './router';

export type SniResolver = (servername: string) => Promise<{ cert: string; key: string }>;

export interface DomainsProxy {
  start(opts: {
    httpPort: number;
    httpsPort: number;
    sni: SniResolver | null;
  }): Promise<{ http: ServerState; https: ServerState }>;
  stop(): Promise<void>;
}

const closeServer = (server: Server) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });

const send = (res: ServerResponse, status: number, html: string) => {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
};

export function createDomainsProxy(deps: {
  table(): RouteTable;
  logger: Logger;
  hosts?: readonly string[];
}): DomainsProxy {
  const hosts = deps.hosts ?? ['127.0.0.1', '::1'];
  let servers: Server[] = [];
  let httpsPort: number | null = null;
  const tunnels = new Set<Duplex>();

  function refuse(socket: Duplex, status: number, reason: string) {
    socket.on('error', () => {});
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  function upgrade(proto: 'http' | 'https') {
    return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const resolution = resolveHost(deps.table(), req.headers.host);
      if (resolution.kind === 'forbidden') return refuse(socket, 403, 'Forbidden');
      if (resolution.kind !== 'forward')
        return refuse(
          socket,
          resolution.kind === 'unknown' ? 404 : 503,
          resolution.kind === 'unknown' ? 'Not Found' : 'Service Unavailable',
        );
      const { route, port } = resolution;
      // Upgrade and Connection are hop-by-hop: put them back for the target.
      const headers = proxyRequestHeaders(req.rawHeaders, {
        host: route.name,
        proto,
        remoteAddress: req.socket.remoteAddress,
        rewriteHostTo: route.rewriteHost ? `localhost:${port}` : null,
      });
      const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
      for (let i = 0; i + 1 < headers.length; i += 2)
        lines.push(`${headers[i]}: ${headers[i + 1]}`);
      lines.push('Connection: Upgrade', `Upgrade: ${req.headers.upgrade ?? 'websocket'}`);
      const upstream: Socket = connect(port, route.ipv6Only ? '::1' : '127.0.0.1');
      tunnels.add(socket);
      tunnels.add(upstream);
      const close = () => {
        socket.destroy();
        upstream.destroy();
        tunnels.delete(socket);
        tunnels.delete(upstream);
      };
      upstream.once('connect', () => {
        upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', (error: NodeJS.ErrnoException) => {
        deps.logger.info('domains upgrade failed', {
          name: route.name,
          port,
          code: error.code ?? 'unknown',
        });
        close();
      });
      socket.on('error', close);
      upstream.on('close', close);
      socket.on('close', close);
    };
  }

  function handle(proto: 'http' | 'https') {
    return (req: IncomingMessage, res: ServerResponse) => {
      const resolution = resolveHost(deps.table(), req.headers.host);
      if (resolution.kind === 'forbidden') return send(res, 403, forbiddenPage());
      if (resolution.kind === 'unknown') return send(res, 404, unknownPage(resolution.known));
      if (resolution.kind === 'not-running')
        return send(res, 503, notRunningPage(resolution.route.name));
      const { route, port } = resolution;
      if (proto === 'http' && httpsPort !== null) {
        const suffix = httpsPort === 443 ? '' : `:${httpsPort}`;
        res.writeHead(308, { location: `https://${route.name}${suffix}${req.url ?? '/'}` });
        return res.end();
      }
      const upstream = request({
        host: route.ipv6Only ? '::1' : '127.0.0.1',
        port,
        method: req.method,
        path: req.url,
        headers: proxyRequestHeaders(req.rawHeaders, {
          host: route.name,
          proto,
          remoteAddress: req.socket.remoteAddress,
          rewriteHostTo: route.rewriteHost ? `localhost:${port}` : null,
        }),
      });
      upstream.on('response', (up) => {
        res.writeHead(up.statusCode ?? 502, up.rawHeaders);
        pipeline(up, res, () => {});
      });
      upstream.on('error', (error: NodeJS.ErrnoException) => {
        deps.logger.info('domains upstream failed', {
          name: route.name,
          port,
          code: error.code ?? 'unknown',
        });
        if (!res.headersSent) send(res, 502, badGatewayPage(route.name, port));
        else res.destroy();
      });
      res.on('close', () => {
        if (!res.writableFinished) upstream.destroy();
      });
      req.pipe(upstream);
    };
  }

  /**
   * Binds one server per loopback address. The first address decides success; a later one may fail only
   * when the machine has no IPv6 (browsers resolve *.localhost to ::1 first), else the whole port is failed.
   */
  async function bind(make: () => Server, port: number): Promise<ServerState> {
    const bound: Server[] = [];
    for (const host of hosts) {
      const server = make();
      const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
        server.once('error', resolve);
        server.listen(port, host, () => resolve(null));
      });
      if (error === null) {
        bound.push(server);
        continue;
      }
      const noIpv6 = error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT';
      if (bound.length > 0 && noIpv6) continue;
      await Promise.all(bound.map((x) => closeServer(x)));
      return { state: 'failed', port, code: error.code ?? 'UNKNOWN', owner: null };
    }
    if (bound.length === 0) return { state: 'failed', port, code: 'UNKNOWN', owner: null };
    servers.push(...bound);
    return { state: 'running', port, code: null, owner: null };
  }

  return {
    async start({ httpPort, httpsPort: wantedHttps, sni }) {
      await this.stop();
      let https: ServerState = { state: 'off', port: wantedHttps, code: null, owner: null };
      if (sni) {
        const contexts = new Map<string, SecureContext>();
        https = await bind(
          () =>
            createHttpsServer(
              {
                requestTimeout: 0,
                SNICallback: (servername, cb) => {
                  const cached = contexts.get(servername);
                  if (cached) return cb(null, cached);
                  sni(servername)
                    .then((pair) => {
                      const ctx = createSecureContext(pair);
                      contexts.set(servername, ctx);
                      cb(null, ctx);
                    })
                    .catch((error: unknown) =>
                      cb(error instanceof Error ? error : new Error('sni failed')),
                    );
                },
              },
              handle('https'),
            ).on('upgrade', upgrade('https')),
          wantedHttps,
        );
      }
      httpsPort = https.state === 'running' ? wantedHttps : null;
      const http = await bind(
        () =>
          createHttpServer({ requestTimeout: 0 }, handle('http')).on('upgrade', upgrade('http')),
        httpPort,
      );
      deps.logger.info('domains started', {
        http: http.state,
        https: https.state,
        httpPort,
        httpsPort: wantedHttps,
      });
      return { http, https };
    },

    async stop() {
      const closing = servers;
      servers = [];
      httpsPort = null;
      for (const socket of tunnels) socket.destroy();
      tunnels.clear();
      await Promise.all(closing.map((server) => closeServer(server)));
    },
  };
}
