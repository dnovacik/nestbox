export const INVOKE_CHANNELS = [
  'app:getInfo',
  'app:openExternal',
  'dialog:pickFolder',
  'projects:list',
  'projects:add',
  'projects:scan',
  'projects:addFolders',
  'projects:remove',
  'projects:rename',
  'projects:setPinned',
  'projects:refresh',
  'projects:openInEditor',
  'projects:openTerminal',
  'projects:move',
  'groups:list',
  'groups:create',
  'groups:rename',
  'groups:delete',
  'groups:setCollapsed',
  'groups:move',
  'tools:list',
  'tools:invoke',
  'tools:busy',
  'settings:get',
  'settings:update',
  'processes:list',
  'processes:stopAll',
  'ports:list',
  'ports:kill',
  'ports:waitFree',
  'deps:overview',
  'deps:checkAll',
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = ['projects:changed', 'tools:event', 'processes:changed', 'app:navigate', 'app:openSettings'] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && (INVOKE_CHANNELS as readonly string[]).includes(value);
}

export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && (EVENT_CHANNELS as readonly string[]).includes(value);
}
