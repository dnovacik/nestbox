import type { EcosystemModule } from './types';

// Registry of all ecosystem modules
// Real modules will be added here (python, dotnet, etc.)
export const ECOSYSTEM_MODULES: ReadonlyArray<EcosystemModule<unknown, unknown>> = [];

// Re-export types
export * from './types';
