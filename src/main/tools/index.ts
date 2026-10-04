import { createClaudeTool, type ClaudeToolDeps } from './claude';
import { createComposeTool, type ComposeToolDeps } from './compose';
import { createDatabaseTool, type DatabaseToolDeps } from './database';
import { createEnvTool, type EnvToolDeps } from './env';
import { createGitTool, type GitToolDeps } from './git';
import { createHealthTool, type HealthToolDeps } from './health';
import { createInspectorTool, type InspectorToolDeps } from './inspector';
import { createMockTool, type MockToolDeps } from './mock';
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
  compose: ComposeToolDeps;
  mock: MockToolDeps;
  inspector: InspectorToolDeps;
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
    createComposeTool(deps.compose),
    createMockTool(deps.mock),
    createInspectorTool(deps.inspector),
  ];
}
