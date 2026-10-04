# NestBox v2 (Inspector tunnel): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04. The owner asked to go on without approval stops; the decisions below are defaults for the owner to review with the PR.
Source of truth: `docs/nestbox-spec.md`, "v2 tools", request inspector: *later a `cloudflared` tunnel*. Builds on the inspector design (`2026-10-04-nestbox-v2-inspector-design.md`).

## Scope

The inspector gets a public HTTPS address, so webhooks from real services (Stripe, GitHub, …) reach the local API through the inspector and are recorded. It ships as **v1.9.0**, from the branch `v2-tunnel`, stacked on the 1.8.0 work.

**Not in this release:**
- Named tunnels or a Cloudflare account.
- Downloading `cloudflared`.
- ngrok or other providers.
- Tunnels for the mock API or the static server.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Provider | Cloudflare quick tunnels (TryCloudflare): `cloudflared tunnel --url http://localhost:<inspector port> --http-host-header localhost:<inspector port> --no-autoupdate`. No account and no config file; the address is random and lasts as long as the process. NestBox uses the `cloudflared` found on PATH (resolved like every other command) and never downloads it. If it isn't installed, the panel says so with a link to Cloudflare's install page. |
| 2 | Where it points | At the inspector port, never straight at the API, so every request through the tunnel is recorded. `--http-host-header` makes cloudflared send `Host: localhost:<port>`, so the inspector's DNS-rebinding check (only local Host names) stays as it is. The tunnel can be started only while the inspector runs. Stopping the inspector stops it. |
| 3 | Confirmation | Starting asks first: "Anyone with the address can reach your API through the inspector until you stop sharing. Requests are recorded." The tunnel is never started automatically and never restarted after a crash. |
| 4 | Process | One `cloudflared` per package, through `ctx.platform.spawnCommand`. Its output is scanned for the first `https://<name>.trycloudflare.com` address. No address within 30 s means the process is killed and the error is "timeout". An exit on its own is reported as "cloudflared stopped (exit N)". Dispose (quit) and project removal kill it. cloudflared's output is shown nowhere and logged nowhere: it can contain the address and connection details. |
| 5 | Privacy | The address is a capability: whoever has it can call the API. It is shown in the panel only, and copied from main on Copy. It is never logged or stored, and never put in the overview card or a notification. The logger records start and stop and the exit code. |
| 6 | Recorded entries | Requests through the tunnel carry `cf-connecting-ip` and `cf-ray`, so an entry with `cf-ray` gets a "tunnel" badge in the list. (A local client could send the header too; the badge is a hint, not a security boundary.) `cf-connecting-ip` is masked like other identifying headers. |
| 7 | Contract | The inspector status gains `tunnel: { state: 'off' \| 'starting' \| 'on' \| 'error', url: string \| null, error: string \| null }` and `cloudflared: boolean \| null` (installed?). New methods: `tunnelStart`, `tunnelStop` and `copyTunnelUrl`. The `changed` event fires on every tunnel state change. |
| 8 | UI | In the inspector header there is a "Share publicly" button: disabled until the inspector runs; when cloudflared is missing, the panel gives an install hint instead. A confirmation dialog follows. While it starts, "Starting tunnel…". Once on, the address appears with Copy and Open, and a "Stop sharing" button. Errors appear in red under the header. The overview card says "shared publicly" (without the address) while a tunnel is on. |
| 9 | Version | 1.9.0. |

## Testing

- **Unit tests:**
  - **Address parsing:** the cloudflared banner, address split across output chunks, and lines that aren't addresses.
  - **Tunnel runner** (fake child): the argv; starting → on; timeout → killed and `timeout`; exit while on → `error`; stop; dispose; no output logged.
  - **Tool:** refused while the inspector is stopped or cloudflared is missing; stopping the inspector stops the tunnel; the status fields; `copyTunnelUrl`.
  - **Masking:** `cf-connecting-ip`.
- **Renderer tests:** the button states (stopped, running, missing cloudflared), the confirmation, the address with Copy and Stop, the error, the "tunnel" badge, and the card's "shared publicly".
- **End-to-end:** a fake `cloudflared` (`e2e/fixtures/fake-cloudflared`, like the fake docker) prints a TryCloudflare banner and waits. Start the inspector, share, confirm, see the address, stop sharing.
