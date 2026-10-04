import type { ComposeStatus, ServiceView } from '@shared/tools/compose/contract';

export const service = (name: string, patch: Partial<ServiceView> = {}): ServiceView => ({
  name,
  state: 'running',
  health: null,
  exitCode: 0,
  ports: [],
  ...patch,
});

/** An ok compose status, for renderer tests. */
export function composeStatus(
  services: ServiceView[],
  patch: Partial<Extract<ComposeStatus, { state: 'ok' }>> = {},
): ComposeStatus {
  return { state: 'ok', file: 'compose.yaml', services, action: null, following: null, ...patch };
}
