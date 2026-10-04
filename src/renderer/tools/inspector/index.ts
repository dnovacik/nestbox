import { lazy } from 'react';
import type { RendererTool } from '../types';
import { InspectorCard } from './OverviewCard';

export const inspectorRendererTool: RendererTool = {
  id: 'inspector',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: InspectorCard,
  fullHeight: true,
};
