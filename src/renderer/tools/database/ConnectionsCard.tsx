import type { DbStatus } from '@shared/tools/database/contract';
import { cn } from '@/lib/utils';
import { REACH_LABELS, TONE_DOT, TONE_TEXT, targetLabel } from './labels';

type Dotnet = NonNullable<DbStatus['dotnet']>;

const select = 'h-7 rounded-md border border-line bg-app px-2 font-mono text-xs text-fg';

/** A .NET package's ConnectionStrings for one environment: where each points and whether it answers. */
export function ConnectionsCard({
  dotnet,
  onEnvironment,
}: {
  dotnet: Dotnet;
  onEnvironment(environment: string): void;
}) {
  return (
    <section
      aria-label="Connections"
      className="space-y-3 rounded-lg border border-line bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
          Connection strings
        </h3>
        <label className="ml-auto flex items-center gap-2 text-xs text-fg-muted">
          Environment
          <select
            aria-label="Environment"
            value={dotnet.environment}
            onChange={(e) => onEnvironment(e.target.value)}
            className={select}
          >
            {/* The current one is offered even when no profile or file names it. */}
            {(dotnet.environments.includes(dotnet.environment)
              ? dotnet.environments
              : [dotnet.environment, ...dotnet.environments]
            ).map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </label>
      </div>
      {dotnet.connections.length === 0 ? (
        <p className="text-xs text-fg-muted">
          No ConnectionStrings in appsettings for {dotnet.environment}.
        </p>
      ) : (
        <ul aria-label="Connection strings" className="space-y-2 text-xs">
          {dotnet.connections.map((c) => {
            const reach = REACH_LABELS[c.reach.result];
            return (
              <li
                key={c.name}
                aria-label={c.name}
                className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)_auto] items-baseline gap-x-4"
              >
                <span className="font-mono font-medium text-fg">{c.name}</span>
                <span className="min-w-0">
                  <span
                    className="block truncate font-mono text-fg"
                    title={c.target.file ?? undefined}
                  >
                    {targetLabel(c.target)}
                  </span>
                  <span className="font-mono text-fg-faint">{c.file}</span>
                </span>
                <span className="text-right">
                  <span className={cn('inline-flex items-center gap-1.5', TONE_TEXT[reach.tone])}>
                    <span aria-hidden className={cn('size-2 rounded-full', TONE_DOT[reach.tone])} />
                    {reach.text}
                  </span>
                  {c.reach.reason && <span className="block text-fg-faint">{c.reach.reason}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {dotnet.truncated && (
        <p className="text-xs text-fg-muted">Only the first 20 connection strings are shown.</p>
      )}
      <p className="text-[11px] text-fg-faint">
        appsettings only: .NET also reads environment variables and user secrets.
      </p>
    </section>
  );
}
