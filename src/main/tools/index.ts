import { projectInfoTool } from './project-info';
import type { AnyMainTool } from './types';

/** Tool registry, main half. */
export const mainTools: readonly AnyMainTool[] = [projectInfoTool];
