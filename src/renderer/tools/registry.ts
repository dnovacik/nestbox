import { claudeRendererTool } from './claude';
import { composeRendererTool } from './compose';
import { databaseRendererTool } from './database';
import { envRendererTool } from './env';
import { gitRendererTool } from './git';
import { healthRendererTool } from './health';
import { inspectorRendererTool } from './inspector';
import { mockRendererTool } from './mock';
import { nodeRendererTool } from './node';
import { projectInfoRendererTool } from './project-info';
import { scriptsRendererTool } from './scripts';
import { staticRendererTool } from './static';
import { todosRendererTool } from './todos';
import type { RendererTool } from './types';

/** Tool registry, renderer half. */
export const rendererTools: readonly RendererTool[] = [
  projectInfoRendererTool,
  scriptsRendererTool,
  envRendererTool,
  staticRendererTool,
  claudeRendererTool,
  gitRendererTool,
  databaseRendererTool,
  todosRendererTool,
  healthRendererTool,
  composeRendererTool,
  mockRendererTool,
  inspectorRendererTool,
  nodeRendererTool,
];

export function getRendererTool(id: string): RendererTool | undefined {
  return rendererTools.find((tool) => tool.id === id);
}
