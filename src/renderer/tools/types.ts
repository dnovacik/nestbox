import type { ComponentType, LazyExoticComponent } from 'react';

export interface ToolPanelProps {
  projectId: string;
}

export type ToolComponent = ComponentType<ToolPanelProps> | LazyExoticComponent<ComponentType<ToolPanelProps>>;

/** Renderer half of a tool; `id` matches the shared ToolDefinition. */
export interface RendererTool {
  id: string;
  Panel: ToolComponent;
  OverviewCard?: ToolComponent;
}
