import type { EcosystemModule } from './types';
import { dotnetModule } from './dotnet';
import { nodeModule } from './node';

// Registry of all ecosystem modules
// Modules are checked in order during detection
export const ECOSYSTEM_MODULES: ReadonlyArray<EcosystemModule<unknown, unknown>> = [
  dotnetModule,
  nodeModule,
];

// Re-export types
export * from './types';
