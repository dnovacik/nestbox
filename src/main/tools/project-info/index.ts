import { projectInfoContract, projectInfoDefinition } from '@shared/tools/project-info/contract';
import { defineMainTool } from '../types';

export const projectInfoTool = defineMainTool({
  ...projectInfoDefinition,
  contract: projectInfoContract,
  handlers: {
    getFacts: async (ctx) => ctx.project,
  },
});
