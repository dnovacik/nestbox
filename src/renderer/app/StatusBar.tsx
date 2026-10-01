export function StatusBar({ projectCount }: { projectCount: number }) {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-card px-4 font-mono text-[11px] text-fg-muted">
      <span>
        {projectCount} {projectCount === 1 ? 'project' : 'projects'}
      </span>
    </footer>
  );
}
