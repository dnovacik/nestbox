import { lazy } from 'react';
import type { RendererTool } from '../types';
import { HealthCard } from './OverviewCard';

export const healthRendererTool: RendererTool = {
  id: 'health',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: HealthCard,
  fullHeight: true,
};
