import type { ComposeStep } from '@shared/tools/scripts/contract';

/** The warning for a run group's compose step that didn't work; null when it did. */
export function composeStepMessage(step: ComposeStep): string | null {
  const where = step.relPath === '' ? 'the root' : step.relPath;
  switch (step.result) {
    case 'ok':
      return null;
    case 'failed':
      return `Compose in ${where} didn't start its services: see its Compose tab`;
    case 'busy':
      return `Compose in ${where} was busy with another action, so its services weren't started`;
    case 'missing':
      return `Compose in ${where} has no compose file or none of the group's services`;
  }
}
