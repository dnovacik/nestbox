import { lazy } from 'react';
import type { RendererTool } from '../types';
import { NodeCard } from './OverviewCard';

export const nodeRendererTool: RendererTool = {
  id: 'node',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: NodeCard,
};
