import { createClaudeTool, type ClaudeToolDeps } from './claude';
import { createDatabaseTool, type DatabaseToolDeps } from './database';
import { createEnvTool, type EnvToolDeps } from './env';
import { createGitTool, type GitToolDeps } from './git';
import { createHealthTool, type HealthToolDeps } from './health';
import { projectInfoTool } from './project-info';
import { createStaticTool, type StaticToolDeps } from './static';
import { createTodosTool, type TodosToolDeps } from './todos';
import { createScriptsTool, type ScriptsToolDeps } from './scripts';
import type { AnyMainTool } from './types';

export interface MainToolDeps {
  scripts: ScriptsToolDeps;
  env: EnvToolDeps;
  static: StaticToolDeps;
  claude: ClaudeToolDeps;
  git: GitToolDeps;
  database: DatabaseToolDeps;
  todos: TodosToolDeps;
  health: HealthToolDeps;
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
    createDatabaseTool(deps.database),
    createTodosTool(deps.todos),
    createHealthTool(deps.health),
  ];
}
