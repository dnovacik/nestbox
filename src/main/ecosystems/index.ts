import type { EcosystemModule } from './types';
import { dotnetModule } from './dotnet';

// Registry of all ecosystem modules
// Modules are checked in order during detection
export const ECOSYSTEM_MODULES: ReadonlyArray<EcosystemModule<unknown, unknown>> = [
  dotnetModule,
];

// Re-export types
export * from './types';
