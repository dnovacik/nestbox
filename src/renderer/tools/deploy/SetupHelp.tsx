import {
  DEPLOY_PLATFORMS,
  type DeployStatus,
  PLATFORM_LABELS,
} from '@shared/tools/deploy/contract';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/state/ui-store';
import { useDeployCommand } from './use-deploy';

/** What NestBox looks for, per platform; Vercel and Netlify can be linked from here. */
const SETUP: Record<(typeof DEPLOY_PLATFORMS)[number], { files: string; link: boolean }> = {
  vercel: { files: 'vercel.json or a .vercel folder (vercel link)', link: true },
  netlify: { files: 'netlify.toml or a .netlify folder (netlify link)', link: true },
  cloudflare: { files: 'wrangler.toml, wrangler.json or wrangler.jsonc', link: false },
  fly: { files: 'fly.toml (fly launch)', link: false },
};

/** Shown when this package has no platform config: where the configs are, or how to add one. */
export function SetupHelp({ projectId, status }: { projectId: string; status: DeployStatus }) {
  const command = useDeployCommand(projectId);
  const select = useUiStore((s) => s.select);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  return (
    <section
      aria-label="Set up deploys"
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <h3 className="text-sm font-semibold text-fg">No deploy config here yet</h3>
      {status.elsewhere.length > 0 && (
        <div className="space-y-1.5 text-xs">
          <p className="text-fg-muted">Found in this project's packages:</p>
          <ul className="flex flex-wrap gap-2">
            {status.elsewhere.map((pkg) => (
              <li key={pkg.projectId}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    select(pkg.projectId);
                    setActiveTab(pkg.projectId, 'deploy');
                  }}
                >
                  {pkg.name} · {pkg.platforms.map((p) => PLATFORM_LABELS[p]).join(', ')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-fg-muted">
        NestBox shows a platform once its config is in this folder:
      </p>
      <ul className="space-y-1.5 text-xs">
        {DEPLOY_PLATFORMS.map((platform) => (
          <li key={platform} className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-fg">{PLATFORM_LABELS[platform]}</span>
            <span className="font-mono text-fg-muted">{SETUP[platform].files}</span>
            {SETUP[platform].link && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => command.mutate({ method: 'link', platform })}
              >
                Link to {PLATFORM_LABELS[platform]} in a terminal
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
