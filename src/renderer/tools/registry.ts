import { claudeRendererTool } from './claude';
import { databaseRendererTool } from './database';
import { envRendererTool } from './env';
import { gitRendererTool } from './git';
import { projectInfoRendererTool } from './project-info';
import { scriptsRendererTool } from './scripts';
import { staticRendererTool } from './static';
import type { RendererTool } from './types';

/** Tool registry, renderer half. */
export const rendererTools: readonly RendererTool[] = [projectInfoRendererTool, scriptsRendererTool, envRendererTool, staticRendererTool, claudeRendererTool, gitRendererTool, databaseRendererTool];

export function getRendererTool(id: string): RendererTool | undefined {
  return rendererTools.find((tool) => tool.id === id);
}
