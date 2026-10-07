import type { EcosystemModule } from './types';
import { dotnetModule } from './dotnet';
import { nodeModule } from './node';

// Registry of all ecosystem modules
// Modules are checked in order during detection
export const ECOSYSTEM_MODULES: ReadonlyArray<EcosystemModule<unknown, unknown>> = [
  dotnetModule,
  nodeModule,
];

/** The local http ports a package's ecosystems say it listens on (e.g. .NET launch profiles), in order. */
export function ecosystemPorts(project: { ecosystems: readonly { id: string; info: unknown }[] }): number[] {
  const ports: number[] = [];
  for (const entry of project.ecosystems) {
    const module = ECOSYSTEM_MODULES.find((m) => m.id === entry.id);
    const parsed = module?.infoSchema.safeParse(entry.info);
    if (!module?.ports || !parsed?.success) continue;
    for (const port of module.ports(parsed.data)) if (!ports.includes(port)) ports.push(port);
  }
  return ports;
}

// Re-export types
export * from './types';
