# NestBox v2 (Light theme): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04. The owner chose this follow-up, to follow the system by default, and a GitHub Light-like palette.
Visual reference: `docs/design/DESIGN-NOTES.md` (the dark tokens). The spec's `theme: 'system' | 'light' | 'dark'` setting has existed since v1 but only dark was built.

## Scope

A light theme with the same flat look and single accent, chosen by the existing `theme` setting (System by default, so NestBox follows the OS and switches live). Ships as **v1.13.0** from `v2-light-theme`, stacked on `v2-deps`.

**Not in this release:** per-project colours, a high-contrast theme, light README screenshots (they stay dark).

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Switch | Main sets Electron's `nativeTheme.themeSource` from the setting at startup and on every change. The renderer then needs no script: the light tokens sit under `@media (prefers-color-scheme: light)`, so there is no flash on load, and System follows the OS live. Native dialogs and menus follow too. |
| 2 | Tokens | Only the `--nb-*` and `--ansi-*` values change; every component keeps its token classes. The `dark` custom variant (shadcn's `dark:` classes) becomes `@media (prefers-color-scheme: dark)` instead of the `.dark` class on `<html>`. |
| 3 | Palette | GitHub Light-like, mirroring the dark palette: bg `#ffffff`, card `#f6f8fa`, surface `#eaeef2`, hover `#e1e6eb`, border `#d0d7de`, text `#1f2328` / `#59636e` / `#8c959f`, accent `#5465e6` (hover `#4352d4`; white text on it is 4.6:1), green `#1a7f37`, amber `#9a6700`, red `#d1242f`, grey `#59636e`. ANSI: GitHub Light's 16 colours. |
| 4 | Window chrome | `window-theme.ts` gets a light set. The window's background and, on Windows, the title-bar overlay (`setTitleBarOverlay`) follow `nativeTheme.shouldUseDarkColors` on creation and on `updated`. |
| 5 | Tray | The tray's `auto` keeps following the taskbar, not the app: it reads `shouldUseDarkColorsForSystemIntegratedUI` (the app theme no longer changes `shouldUseDarkColors` alone). |
| 6 | Settings | "Theme: System / Light / Dark" in the Settings dialog (`theme` joins `SettingsPatchSchema`). The toaster uses `theme="system"`. |
| 7 | Screenshots | `scripts/screenshots.mjs` sets the theme to dark, so the README stays as it is under a light test desktop. |
| 8 | Version | 1.13.0. |

## Testing

- Unit tests: the settings patch, main applying `themeSource` at startup and on change, the window colours per theme, the tray's auto reading the system-UI flag.
- Renderer tests: the Theme select saves.
- End-to-end: with `theme: light` the page background is the light token (computed style), with `dark` the dark one; switching in Settings changes it live.
- Visual: screenshots of the overview, scripts, a log with ANSI colours and the Dependencies tab in light, reviewed by eye.
