import { lazy } from 'react';
import type { RendererTool } from '../types';
import { ComposeCard } from './OverviewCard';

export const composeRendererTool: RendererTool = {
  id: 'compose',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: ComposeCard,
  fullHeight: true,
};
