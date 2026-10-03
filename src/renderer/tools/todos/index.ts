import { lazy } from 'react';
import type { RendererTool } from '../types';
import { TodosCard } from './OverviewCard';

export const todosRendererTool: RendererTool = {
  id: 'todos',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: TodosCard,
  fullHeight: true,
};
