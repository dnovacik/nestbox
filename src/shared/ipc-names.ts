export const INVOKE_CHANNELS = [
  'app:getInfo',
  'dialog:pickFolder',
  'projects:list',
  'projects:add',
  'projects:remove',
  'projects:rename',
  'projects:setPinned',
  'projects:refresh',
  'projects:openInEditor',
  'projects:openTerminal',
  'tools:list',
  'tools:invoke',
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = ['projects:changed', 'tools:event'] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && (INVOKE_CHANNELS as readonly string[]).includes(value);
}

export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && (EVENT_CHANNELS as readonly string[]).includes(value);
}
