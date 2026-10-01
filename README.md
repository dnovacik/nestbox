# nestbox

A local developer toolbox for Node.js and TypeScript projects: run scripts and read their logs, free stuck ports, keep `.env` files in order, serve a build, and hand a project to Claude Code.

> Work in progress: milestone M0 (skeleton). Windows first; macOS later.

## License

[MIT](LICENSE)

## Development

Requirements: Node 22.12+, pnpm 10.

```bash
pnpm install
pnpm dev        # run the app
pnpm test       # unit tests
pnpm lint && pnpm typecheck
```

See [CLAUDE.md](CLAUDE.md) for structure and conventions.
