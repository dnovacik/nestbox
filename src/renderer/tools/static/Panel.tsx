import { FolderOpen, Play, Square, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NestboxError } from '@shared/errors';
import { MAX_LATENCY_MS, type ServerConfig } from '@shared/tools/static/contract';
import { LogView } from '@/components/log/LogView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import type { ToolPanelProps } from '../types';
import { QrCode } from './QrCode';
import { staticLogSource, useRunningServers, useStaticActions, useStaticConfig, useStaticStatus } from './use-static';

function UrlLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      className="font-mono text-xs text-brand hover:underline"
      onClick={(e) => {
        e.preventDefault();
        void api.app.openExternal(url);
      }}
    >
      {url}
    </a>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-fg" title={hint}>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}

/** Serves a folder (by default the build output) with SPA fallback, LAN sharing and HTTPS. */
export default function StaticPanel({ projectId }: ToolPanelProps) {
  const { data: status } = useStaticStatus(projectId);
  const { data: config } = useStaticConfig(projectId);
  const { data: running = [] } = useRunningServers(projectId);
  const actions = useStaticActions(projectId);
  const source = useMemo(() => staticLogSource(projectId), [projectId]);
  const [portText, setPortText] = useState('');
  const [startError, setStartError] = useState<{ message: string; nextPort: number | null } | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => setPortText(config?.port === null || config?.port === undefined ? '' : String(config.port)), [config?.port]);

  if (!status || !config) return <p className="p-6 text-sm text-fg-muted">Loading…</p>;

  const save = (patch: Partial<ServerConfig>) => actions.setConfig.mutate({ ...config, ...patch });

  const start = async () => {
    setStartError(null);
    try {
      await actions.start.mutateAsync();
    } catch (error) {
      const busy = error instanceof NestboxError && error.code === 'CONFLICT';
      const next = busy ? await api.tools.invoke('static', projectId, 'nextFreePort', {}).catch(() => null) : null;
      setStartError({ message: errorMessage(error), nextPort: next?.port ?? null });
    }
  };

  const savePort = () => {
    const trimmed = portText.trim();
    const port = trimmed === '' ? null : Number(trimmed);
    if (port !== null && !(Number.isInteger(port) && port >= 1 && port <= 65_535)) return;
    if (port !== config.port) save({ port });
  };

  const others = running.filter((r) => r.projectId !== projectId);

  return (
    <section aria-label="Static server" className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3 rounded-lg border border-line bg-card p-4">
          <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Server</h3>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={status.folder}>
              {status.folder}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const picked = await api.tools.invoke('static', projectId, 'pickFolder', {});
                if (picked.folder !== null) save({ folder: picked.folder });
              }}
            >
              <FolderOpen />
              Browse…
            </Button>
          </div>
          {status.servesPackageRoot && (
            <p className="flex items-center gap-1.5 text-[11px] text-warn">
              <TriangleAlert className="size-3.5" aria-hidden />
              This serves the whole package folder, source files included (dotfiles never are).
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            Port
            <Input
              aria-label="Port"
              type="number"
              inputMode="numeric"
              placeholder="auto (4173+)"
              value={portText}
              onChange={(e) => setPortText(e.target.value)}
              onBlur={savePort}
              className="h-7 w-32 text-xs"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Toggle label="SPA fallback" checked={config.spa} onChange={(spa) => save({ spa })} hint="Unknown routes return index.html" />
            <Toggle label="Share on LAN" checked={config.lan} onChange={(lan) => save({ lan })} hint="Bind 0.0.0.0 and show the LAN URL" />
            <Toggle label="HTTPS" checked={config.https} onChange={(https) => save({ https })} hint="Self-signed certificate" />
            <Toggle label="CORS" checked={config.cors} onChange={(cors) => save({ cors })} />
            <Toggle label="No cache" checked={config.noCache} onChange={(noCache) => save({ noCache })} />
          </div>
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            Latency
            <input
              type="range"
              aria-label="Latency"
              min={0}
              max={MAX_LATENCY_MS}
              step={100}
              value={latency ?? config.latencyMs}
              onChange={(e) => setLatency(Number(e.target.value))}
              // Saved when let go (mouse, touch or keyboard), not on every step of a drag.
              onPointerUp={() => latency !== null && save({ latencyMs: latency })}
              onKeyUp={() => latency !== null && save({ latencyMs: latency })}
              onBlur={() => setLatency(null)}
              className="flex-1 accent-brand"
            />
            <span className="w-16 text-right font-mono">{latency ?? config.latencyMs} ms</span>
          </label>
        </div>

        <div className="space-y-3 rounded-lg border border-line bg-card p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Status</h3>
            <span className={status.running ? 'text-xs text-ok' : 'text-xs text-fg-faint'}>{status.running ? 'running' : 'stopped'}</span>
            <span className="ml-auto">
              {status.running ? (
                <Button size="sm" variant="secondary" onClick={() => actions.stop.mutate()}>
                  <Square className="text-err" />
                  Stop
                </Button>
              ) : (
                <Button size="sm" onClick={() => void start()} disabled={actions.start.isPending}>
                  <Play />
                  Start
                </Button>
              )}
            </span>
          </div>
          {startError && (
            <div className="flex items-center gap-2 text-xs text-err">
              <span>{startError.message}</span>
              {startError.nextPort !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    save({ port: startError.nextPort });
                    setStartError(null);
                  }}
                >
                  Use port {startError.nextPort}
                </Button>
              )}
            </div>
          )}
          {status.configChanged && <p className="text-[11px] text-warn">Restart to apply the changes.</p>}
          {status.localUrl && <UrlLink url={status.localUrl} />}
          {status.lanUrls.length > 0 && (
            <div className="flex flex-wrap items-start gap-4">
              <div className="space-y-1">
                {status.lanUrls.map((url) => (
                  <div key={url}>
                    <UrlLink url={url} />
                  </div>
                ))}
                <p className="text-[11px] text-fg-faint">Same Wi-Fi or network only.</p>
              </div>
              {status.lanUrls[0] && <QrCode value={status.lanUrls[0]} label={`QR code for ${status.lanUrls[0]}`} />}
            </div>
          )}
          {others.length > 0 && (
            <p className="text-[11px] text-fg-faint">
              Also running: {others.map((r) => r.url).join(', ')}
            </p>
          )}
        </div>
      </div>
      <div className="flex min-h-64 flex-1 flex-col">
        <LogView source={source} name="Requests" emptyHint="Start the server to see its requests." />
      </div>
    </section>
  );
}
