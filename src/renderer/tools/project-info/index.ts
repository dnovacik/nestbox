import { lazy } from 'react';
import type { RendererTool } from '../types';
import { ProjectInfoCard } from './OverviewCard';

export const projectInfoRendererTool: RendererTool = {
  id: 'project-info',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: ProjectInfoCard,
};
