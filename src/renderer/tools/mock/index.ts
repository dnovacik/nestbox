import { lazy } from 'react';
import type { RendererTool } from '../types';
import { MockCard } from './OverviewCard';

export const mockRendererTool: RendererTool = {
  id: 'mock',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: MockCard,
  fullHeight: true,
};
