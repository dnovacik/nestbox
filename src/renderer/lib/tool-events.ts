import { useEffect, useRef } from 'react';
import { ToolEventEnvelopeSchema } from '@shared/tool';
import { type ToolEventName, type ToolEventPayload, type ToolId, toolEvents } from '@shared/tools';
import { api } from './api';

/**
 * Listens for one tool event of one project. Payloads that fail the tool's event schema are dropped.
 * Returns the unsubscribe function. For use outside React; components use useToolEvent.
 */
export function subscribeToolEvent<T extends ToolId, E extends ToolEventName<T>>(
  toolId: T,
  projectId: string,
  event: E,
  onEvent: (payload: ToolEventPayload<T, E>) => void,
): () => void {
  const schema = (toolEvents[toolId] as Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }>)[event];
  return api.on('tools:event', (raw) => {
    const envelope = ToolEventEnvelopeSchema.safeParse(raw);
    if (!envelope.success || !schema) return;
    const { data } = envelope;
    if (data.toolId !== toolId || data.projectId !== projectId || data.event !== event) return;
    const payload = schema.safeParse(data.payload);
    if (payload.success) onEvent(payload.data as ToolEventPayload<T, E>);
  });
}

export function useToolEvent<T extends ToolId, E extends ToolEventName<T>>(
  toolId: T,
  projectId: string,
  event: E,
  onEvent: (payload: ToolEventPayload<T, E>) => void,
): void {
  const latest = useRef(onEvent);
  useEffect(() => {
    latest.current = onEvent;
  });
  useEffect(
    () => subscribeToolEvent(toolId, projectId, event, (payload) => latest.current(payload)),
    [toolId, projectId, event],
  );
}
