import { useEffect } from 'react';
import type { Theme } from '@shared/types';
import { useSettings } from './queries';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** 'light' or 'dark' for a theme setting; System follows the OS. */
export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

/**
 * Puts the theme in effect on <html data-theme>, which the tokens in globals.css key off. Main also sets
 * nativeTheme.themeSource, but prefers-color-scheme doesn't follow it everywhere (Linux), so the attribute
 * is what counts; the media query only covers the first paint before settings load.
 */
export function useAppliedTheme(): void {
  const { data } = useSettings();
  const theme = data?.theme ?? 'system';
  useEffect(() => {
    // jsdom (renderer tests) has no matchMedia: the default theme is dark.
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
    const apply = () => {
      document.documentElement.dataset['theme'] = resolveTheme(theme, media?.matches ?? true);
    };
    apply();
    media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, [theme]);
}
