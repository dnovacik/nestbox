import { NestboxMark } from '@/components/NestboxMark';
import { useAppInfo } from '@/lib/queries';
import type { ProjectNode } from './find-project';

export function TitleBar({ node }: { node: ProjectNode | null }) {
  const { data: info } = useAppInfo();
  const git = node?.detected.git;
  const ref = git?.branch ?? git?.head ?? null;
  return (
    <header
      className="drag flex h-10 shrink-0 items-center border-b border-line bg-card pr-3"
      // Leave room for native window controls (titleBarOverlay on Windows, traffic lights on macOS).
      style={{ paddingLeft: 'max(12px, env(titlebar-area-x, 0px))', width: 'env(titlebar-area-width, 100%)' }}
    >
      <div className="flex items-center gap-2">
        <NestboxMark className="size-4" />
        <span className="text-xs font-bold tracking-wide text-fg">nestbox</span>
        {info && (
          <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
            v{info.version}
          </span>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-fg-muted">
        {node &&
          (node.isWorkspace ? (
            <span>
              <span>{node.summary.name}</span>
              <span aria-hidden className="mx-1.5 text-fg-faint">
                ·
              </span>
              <span className="text-fg">{node.detected.name}</span>
            </span>
          ) : (
            <span>{node.detected.name}</span>
          ))}
        {node && ref && (
          <>
            <span aria-hidden className="text-fg-faint">
              •
            </span>
            <span className="font-mono text-[11px] text-brand">{ref}</span>
          </>
        )}
      </div>
    </header>
  );
}
