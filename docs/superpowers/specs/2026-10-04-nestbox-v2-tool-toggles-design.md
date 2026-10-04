# NestBox v2 (Tool toggles): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04. The owner asked for tools that can be turned on and off, picked on first start and changed in Settings. They chose:
- app-wide (not per project);
- Overview, Project info and Scripts always on;
- "off" means hidden and idle;
- the picker for new installs only, while upgrades keep every tool on.

## Scope

**Ships as** v1.17.0 from `v2-tool-toggles`, based on `main` (1.16.0).

**Settings → Tools:** a switch per tool.

**First run:** a fresh profile opens a picker with three presets:
- **Everything**;
- **Essentials:** Env, Claude Code, Git, Node, Dependencies;
- **None:** core only.

The user can also change any switch. A disabled tool disappears from:
- project tabs;
- overview cards;
- command palette entries;
- the Dependencies sidebar page.

Main refuses its calls and stops its background work.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Storage | `AppSettings.disabledTools: string[]` (a Zod default of `[]`), so tools added later start on. `AppSettings.toolsChosen: boolean` defaults to `true`, so existing stores never see the picker; `defaultStoreData()` writes `false`, so only a fresh store does. No schema version bump. |
| 2 | Core | `ALWAYS_ON_TOOLS = ['project-info', 'scripts']`. They are never disabled, whatever the stored list says. The Ports page is core and not a tool. The patch schema accepts only the ids of tools that can be toggled. |
| 3 | Gate | The tool host gets `isEnabled(toolId)`: `list` drops disabled tools, and `invoke` answers NOT_FOUND ("turned off"). Tool-to-tool calls go through the host, so they fail softly: Node advice before a start, Compose steps in run groups (`missing`), and the Ready checks (`skip`). |
| 4 | Idle | Turning a tool off runs its `forgetProject` for every root project: servers, studios, followers, deploys and watchers stop, and the tool stays reusable. Health's process feed is gated: no live sessions while it is off. The dependency schedule reads "off" while Dependencies is off, and `deps:checkAll` does nothing. |
| 5 | Busy | A new optional `busy()` on main tools (Static, Mock API, Inspector, Database, Compose, Deploy, Claude Code) answers whether something of it runs. New core channel `tools:busy` → busy tool ids. Turning a busy tool off asks first, naming what stops. |
| 6 | Renderer | The settings mutation invalidates every tools list. A selected tab that disappears falls back to Overview. The Dependencies entry and page hide when Dependencies is off. Claude palette entries need Claude Code on. |
| 7 | First run | A modal that can't be dismissed without choosing ("Start with these tools" saves `disabledTools` and `toolsChosen: true`). A read-only store skips it. |
| 8 | Version | 1.17.0. |

## Testing

- **Unit tests:**
  - settings defaults (old store vs fresh store);
  - patch validation;
  - the tool host gate (list, invoke, always-on);
  - deactivation runs `forgetProject` per root;
  - busy ids;
  - the gated Health feed and deps schedule;
  - palette gating.
- **Renderer:** Settings → Tools (switches, the busy confirmation), the first-run picker (presets, save), tab fallback.
- **End-to-end:** the helper seeds `toolsChosen: true` so the other specs skip the picker. A new spec covers the first run with Essentials (no Static tab), then turning Static on in Settings, after which its tab appears.
