# NestBox v2 (Light theme) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-light-theme-design.md` (D1–D8).
> Branch: `v2-light-theme`, stacked on `v2-deps`. One PR, released as v1.13.0 after 1.12.0.

1. `theme` in `SettingsPatchSchema`; main applies `nativeTheme.themeSource` at startup and on settings change (+ tests).
2. Light window colours; background and Windows overlay follow `nativeTheme` (+ tests). Tray auto reads the system-UI flag.
3. CSS: light tokens and ANSI under `prefers-color-scheme: light`; the `dark` variant by media query; drop `class="dark"`; toaster `system`.
4. Settings dialog Theme select (+ test).
5. Screenshots script forces dark. End-to-end theme spec. Visual review of light screens.
6. README, CLAUDE.md (dark-only line), HANDOFF; version 1.13.0. PR, CI.
