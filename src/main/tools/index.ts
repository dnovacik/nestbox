import { projectInfoTool } from './project-info';
import { createScriptsTool, type ScriptsToolDeps } from './scripts';
import type { AnyMainTool } from './types';

export interface MainToolDeps {
  scripts: ScriptsToolDeps;
}

/** Tool registry, main half. Tools that need core services are built by factories. */
export function createMainTools(deps: MainToolDeps): readonly AnyMainTool[] {
  return [projectInfoTool, createScriptsTool(deps.scripts)];
}
