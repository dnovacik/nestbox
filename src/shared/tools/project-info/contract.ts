import { z } from 'zod';
import { DetectedProjectSchema } from '../../detected';
import { defineContract, type ToolDefinition } from '../../tool';

const settingsSchema = z.strictObject({});

export const projectInfoDefinition: ToolDefinition<z.infer<typeof settingsSchema>> = {
  id: 'project-info',
  name: 'Project info',
  icon: 'info',
  appliesTo: () => true,
  settingsSchema,
};

export const projectInfoContract = defineContract({
  getFacts: { input: z.strictObject({}), output: DetectedProjectSchema },
});
