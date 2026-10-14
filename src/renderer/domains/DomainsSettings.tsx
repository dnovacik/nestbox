import { useState } from 'react';
import type { ServerState } from '@shared/domains';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useDomainsActions, useDomainsStatus } from './use-domains';

function serverLine(label: string, s: ServerState): string {
  if (s.state === 'running') return `${label} on port ${s.port}`;
  if (s.state === 'off') return `${label} off`;
  if (s.code === 'EADDRINUSE')
    return s.owner ? `Port ${s.port} is in use by ${s.owner}` : `Port ${s.port} is in use`;
  if (s.code === 'EACCES') return `Not allowed to use port ${s.port}`;
  return `${label} couldn't start (${s.code ?? 'unknown'})`;
}

const TRUST_LABEL = {
  none: 'Not trusted yet',
  trusted: 'Trusted',
  untrusted: 'Not trusted',
} as const;

const validPort = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65_535;

export function DomainsSettings() {
  const { data } = useDomainsStatus();
  const actions = useDomainsActions();
  const [http, setHttp] = useState<string | null>(null);
  const [https, setHttps] = useState<string | null>(null);
  if (!data) return null;
  const httpPort = Number(http ?? data.http.port);
  const httpsPort = Number(https ?? data.https.port);
  const portsOk = validPort(httpPort) && validPort(httpsPort) && httpPort !== httpsPort;
  const portsChanged = httpPort !== data.http.port || httpsPort !== data.https.port;

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">Local domains</p>
          <p className="text-xs text-fg-muted">
            Reach projects at https://&lt;name&gt;.localhost instead of a port.
          </p>
        </div>
        <Switch
          aria-label="Local domains"
          checked={data.enabled}
          onCheckedChange={(enabled) =>
            actions.setEnabled.mutate(enabled, {
              onSuccess: (status) => {
                if (enabled && status.trust === 'none') actions.trust.mutate();
              },
            })
          }
        />
      </div>
      {data.enabled && (
        <>
          <ul className="space-y-0.5 text-xs">
            {[serverLine('HTTPS', data.https), serverLine('HTTP', data.http)].map((line) => (
              <li
                key={line}
                className={
                  line.includes('in use') ||
                  line.includes("couldn't") ||
                  line.includes('Not allowed')
                    ? 'text-warn'
                    : 'text-fg-muted'
                }
              >
                {line}
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <label className="text-xs text-fg-muted">
              HTTP port
              <Input
                aria-label="HTTP port"
                className="mt-1 h-7 w-24 text-xs"
                value={http ?? String(data.http.port)}
                onChange={(e) => setHttp(e.target.value)}
              />
            </label>
            <label className="text-xs text-fg-muted">
              HTTPS port
              <Input
                aria-label="HTTPS port"
                className="mt-1 h-7 w-24 text-xs"
                value={https ?? String(data.https.port)}
                onChange={(e) => setHttps(e.target.value)}
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!portsOk || !portsChanged || actions.setPorts.isPending}
              onClick={() =>
                actions.setPorts.mutate(
                  { httpPort, httpsPort },
                  {
                    onSuccess: () => {
                      setHttp(null);
                      setHttps(null);
                    },
                  },
                )
              }
            >
              Apply ports
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={data.trust === 'trusted' ? 'text-ok' : 'text-warn'}>
              {TRUST_LABEL[data.trust]}
            </span>
            {data.trust !== 'trusted' && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => actions.trust.mutate()}
              >
                {data.trust === 'none' ? 'Trust' : 'Trust again'}
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => actions.remove.mutate()}>
              Remove NestBox's certificate authority
            </Button>
          </div>
          <p className="text-[11px] text-fg-faint">
            Browsers only: backends should keep calling localhost:&lt;port&gt;. Next.js may need the
            name in allowedDevOrigins. Firefox: Settings → Privacy &amp; Security → Certificates →
            "Allow Firefox to automatically trust third-party root certificates you install".
          </p>
        </>
      )}
    </div>
  );
}
