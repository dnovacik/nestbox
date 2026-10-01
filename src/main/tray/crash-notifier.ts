import type { ProcessSummary } from '@shared/processes';
import { MAX_CRASHES } from '../processes/process-manager';

/**
 * Text for a crash notification. Never includes log output (exit.lastLine may hold anything a script
 * printed, secrets included): only the script, the project and how it ended.
 */
export function crashNotice(summary: ProcessSummary, projectLabel: string): { title: string; body: string } {
  const who = `${summary.script} crashed in ${projectLabel}`;
  if (summary.gaveUp) return { title: 'NestBox', body: `${who} and gave up after ${MAX_CRASHES} crashes` };
  const exit = summary.exit;
  const how =
    exit?.code !== null && exit?.code !== undefined
      ? `exit ${exit.code}`
      : exit?.signal
        ? `killed by ${exit.signal}`
        : 'could not start';
  return { title: 'NestBox', body: `${who} (${how})` };
}
