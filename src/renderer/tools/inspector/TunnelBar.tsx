import { Clipboard, ExternalLink, Globe, Loader2, Square } from 'lucide-react';
import { useState } from 'react';
import type { InspectorStatus } from '@shared/tools/inspector/contract';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useInspectorActions } from './use-inspector';

const INSTALL_URL =
  'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/';

/** "Share publicly": a Cloudflare quick tunnel to the inspector, after a confirmation. */
export function TunnelBar({ projectId, status }: { projectId: string; status: InspectorStatus }) {
  const actions = useInspectorActions(projectId);
  const [confirm, setConfirm] = useState(false);
  const tunnel = status.tunnel;

  if (status.cloudflared === false) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <Globe className="size-3.5" aria-hidden />
        Install cloudflared to share the inspector at a public address (for webhooks).
        <Button variant="ghost" size="sm" onClick={() => void api.app.openExternal(INSTALL_URL)}>
          How to install
        </Button>
      </p>
    );
  }

  return (
    <section aria-label="Public address" className="flex flex-wrap items-center gap-2 text-xs">
      <Globe className="size-3.5 text-fg-muted" aria-hidden />
      {tunnel.state === 'on' && tunnel.url ? (
        <>
          <span className="font-mono text-fg select-text">{tunnel.url}</span>
          <Button variant="ghost" size="sm" onClick={() => actions.copyTunnelUrl.mutate()}>
            <Clipboard className="size-3.5" aria-hidden />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Open the public address"
            onClick={() => void api.app.openExternal(tunnel.url ?? '')}
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={actions.tunnelStop.isPending}
            onClick={() => actions.tunnelStop.mutate()}
          >
            <Square className="size-3.5" aria-hidden />
            Stop sharing
          </Button>
        </>
      ) : tunnel.state === 'starting' ? (
        <>
          <Loader2 className="size-3.5 animate-spin text-fg-muted" aria-hidden />
          <span className="text-fg-muted">Starting tunnel…</span>
          <Button variant="ghost" size="sm" onClick={() => actions.tunnelStop.mutate()}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="secondary"
            size="sm"
            disabled={!status.running || actions.tunnelStart.isPending}
            title={status.running ? undefined : 'Start the inspector first'}
            onClick={() => setConfirm(true)}
          >
            Share publicly
          </Button>
          <span className="text-fg-faint">
            A temporary https address for webhooks, through Cloudflare.
          </span>
          {tunnel.state === 'error' && tunnel.error && (
            <span className="text-err">{tunnel.error}</span>
          )}
        </>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Share the inspector publicly?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone with the address can reach your API through the inspector until you stop
              sharing. Requests are recorded. The address is random and ends when you stop sharing
              or quit NestBox.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => actions.tunnelStart.mutate()}>
              Share
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
