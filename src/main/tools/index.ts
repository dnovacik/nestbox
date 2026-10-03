import { createClaudeTool, type ClaudeToolDeps } from './claude';
import { createEnvTool, type EnvToolDeps } from './env';
import { createGitTool, type GitToolDeps } from './git';
import { projectInfoTool } from './project-info';
import { createStaticTool, type StaticToolDeps } from './static';
import { createScriptsTool, type ScriptsToolDeps } from './scripts';
import type { AnyMainTool } from './types';

export interface MainToolDeps {
  scripts: ScriptsToolDeps;
  env: EnvToolDeps;
  static: StaticToolDeps;
  claude: ClaudeToolDeps;
  git: GitToolDeps;
}

/** Tool registry, main half. Tools that need core services are built by factories. */
export function createMainTools(deps: MainToolDeps): readonly AnyMainTool[] {
  return [
    projectInfoTool,
    createScriptsTool(deps.scripts),
    createEnvTool(deps.env),
    createStaticTool(deps.static),
    createClaudeTool(deps.claude),
    createGitTool(deps.git),
  ];
}
