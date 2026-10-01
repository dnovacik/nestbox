import { envRendererTool } from './env';
import { projectInfoRendererTool } from './project-info';
import { scriptsRendererTool } from './scripts';
import { staticRendererTool } from './static';
import type { RendererTool } from './types';

/** Tool registry, renderer half. */
export const rendererTools: readonly RendererTool[] = [projectInfoRendererTool, scriptsRendererTool, envRendererTool, staticRendererTool];

export function getRendererTool(id: string): RendererTool | undefined {
  return rendererTools.find((tool) => tool.id === id);
}
