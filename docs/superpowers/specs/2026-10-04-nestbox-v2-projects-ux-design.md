# NestBox v2 (Projects UX): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04. It comes from the owner's report: the Deploy tab never showed, and a folder holding app/ and api/ was not picked up. They also asked for groups, rename/alias and reordering.

Answers:
- Deploy tab always, with setup help;
- sub-folders as packages;
- one-level groups with drag and drop.

Ships as **v1.18.0** from `v2-projects-ux`, based on `main` at 1.17.0.

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Multi-folder | Without a workspaces config, the packages are the folders one or two levels down that have a package.json. Skipped: `node_modules`, dot, `dist`/`build`/`out`/`coverage`/`vendor`/`tmp`, `test(s)`/`e2e`/`fixtures`/`__fixtures__`/`example(s)`. Symlinks leaving the root are dropped, as for workspaces. |
| 2 | Deploy tab | Applies to every package with a package.json. Without a platform config it shows setup help: what each platform needs, Link in a terminal for Vercel/Netlify, and buttons to the packages that have a config. The overview card stays hidden until a platform is found. |
| 3 | Groups | `StoreData.groups` (`{ id, name, collapsed }`, ordered) and `Project.groupId`, both with Zod defaults (the store stays v2). One level. Pinned projects show only under Pinned. Deleting a group keeps its projects, ungrouped. |
| 4 | Order | The projects array order is the display order. `projects:move { id, groupId, beforeId }` and `groups:move { id, beforeId }` (null = last) rewrite projects and groups in one write. |
| 5 | Rename | Inline, by double-click, F2, or the row menu. A root's rename sets its stored name. A workspace package's rename sets an alias on the root (`aliases[relPath]`). |
| 6 | Interaction | HTML5 drag and drop: a project onto a project (before it), onto a group header or its empty area (last in it), or onto "Other projects" (ungrouped); a group onto a group header (before it). Each row's menu has Rename, Pin/Unpin, Move to group (with New group…), and Move up/down for keyboard users. |
