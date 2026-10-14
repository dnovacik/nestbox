import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { DomainsStatus } from '@shared/domains';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useDomainsStatus } from './use-domains';

export function domainUrl(status: DomainsStatus, name: string): string {
  const https = status.https.state === 'running';
  const port = https ? status.https.port : status.http.port;
  const suffix = (https && port === 443) || (!https && port === 80) ? '' : `:${port}`;
  return `${https ? 'https' : 'http'}://${name}${suffix}`;
}

/** The project's local domain in the header: a link while it routes somewhere, greyed out otherwise. */
export function DomainLink({ projectId }: { projectId: string }) {
  const { data } = useDomainsStatus();
  // The project's own route comes first: buildRoutes pushes it before its extra servers' routes.
  const route = data?.enabled ? data.routes.find((r) => r.projectId === projectId) : undefined;
  if (!data || !route) return null;
  const url = domainUrl(data, route.name);
  if (route.port === null)
    return (
      <span
        aria-disabled="true"
        title="Start the project's main command to use its local domain"
        className="text-fg-faint"
      >
        {url}
      </span>
    );
  return (
    <span className="flex items-center gap-1">
      <a
        href={url}
        className="text-fg underline-offset-2 hover:underline"
        onClick={(e) => {
          e.preventDefault();
          void api.app.openExternal(url);
        }}
      >
        {url}
      </a>
      <Button
        variant="ghost"
        size="icon"
        className="size-5"
        aria-label="Copy local domain"
        onClick={() =>
          void navigator.clipboard.writeText(url).then(
            () => toast.success('Copied'),
            () => toast.error("Couldn't copy the address"),
          )
        }
      >
        <Copy className="size-3" aria-hidden />
      </Button>
    </span>
  );
}
