import type { PlatformId } from '@shared/types';
import { useAppInfo } from './queries';

/** The platform main runs on; null until app:getInfo answers. */
export function usePlatform(): PlatformId | null {
  return useAppInfo().data?.platform ?? null;
}

/** The shortcut modifier to show in hints: ⌘ on macOS, Ctrl elsewhere (and before the platform is known). */
export function useModKey(): '⌘' | 'Ctrl' {
  return usePlatform() === 'darwin' ? '⌘' : 'Ctrl';
}
