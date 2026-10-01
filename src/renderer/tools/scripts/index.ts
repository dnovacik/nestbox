import { lazy } from 'react';
import type { RendererTool } from '../types';
import { ScriptsCard } from './OverviewCard';

export const scriptsRendererTool: RendererTool = {
  id: 'scripts',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: ScriptsCard,
  fullHeight: true,
};
