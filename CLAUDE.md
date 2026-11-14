@AGENTS.md

# SafeHub

Self-hosted home server dashboard and monitor. One place to view, monitor and control everything on the home network.

## Goals

- **Dashboard**: status, health and key stats for every host and service.
- **Control**: start/stop/restart VMs, LXCs and containers; trigger service actions (scans, refreshes, requests).
- **Monitoring**: uptime history, resource usage (CPU, RAM, disk, network), alerts.

## Infrastructure being managed

| Host | Role | API |
|------|------|-----|
| Synology NAS | Storage, possibly Docker (Container Manager) | DSM Web API (`/webapi/entry.cgi`) |
| Proxmox mini PC | Hypervisor running the services below | Proxmox VE API (`:8006/api2/json`), API token auth |

Services (running on Proxmox):

- **\*arr stack**: Sonarr, Radarr, Prowlarr, Bazarr, etc. (REST API v3, `X-Api-Key` header)
- **Jellyfin**: media server (REST API, API key)
- **Seerr**: media requests (Overseerr/Jellyseerr API, `X-Api-Key`)
- **Immich**: photos (REST API, `x-api-key`)
- **Caddy**: reverse proxy (not monitored; the integration was removed on purpose)

Real hostnames, IPs, ports and keys live in env/config, never in code.

## Tech stack

- Next.js 16 (App Router, `src/app`), React 19, TypeScript strict
- Tailwind CSS 4
- Path alias: `@/*` resolves to `src/*`
- This Next.js version differs from older versions. Check `node_modules/next/dist/docs/` before using any Next.js API.

## Commands

```bash
npm run dev     # dev server
npm run build   # production build
npm run start   # run production build
npm run lint    # eslint
npm run typecheck    # next typegen + tsc (route types like PageProps are generated)
npm test        # Vitest: unit + integration tests (src/**/*.test.ts, tests/)
npm run test:smoke   # after build: runs the standalone server, opens every page
npm run db:generate  # create a migration after changing src/db/schema
npm run db:migrate   # apply new migrations to the dev DB without restarting
npm run db:studio    # browse the database
```

## Integration pattern

Follow `src/lib/integrations/proxmox/` for every new service:

- `schemas.ts`: zod schemas for API responses and for action input (validate anything that ends up in a URL).
- `index.ts`: `server-only`. Builds a client from `env` (null when unset) with `createHttpClient` (`../http.ts`: base URL, auth headers, per-service TLS agent from `../tls.ts`, 5 s timeout, zod-parsed JSON). Public functions return `IntegrationResult<T>` (`../result.ts`): `ok` / `not-configured` / `error`; wrap with `attempt()`. Never throw to the caller.
- Small adapters can keep their schemas inline in `index.ts`.
- Simple status services (\*arr, Bazarr, Jellyfin, Seerr, Immich) return a `ServiceSummary` (version, stats, issues) and are registered in `src/lib/integrations/services.ts`; the dashboard's Services card renders that list. Adding a service = adapter + one registry line + env vars.
- **Settings** (`src/lib/settings/`): integration settings come from `getSetting(key)` / `getFlag(key)`, never from `env` directly. Order: env (compose.yaml / .env, shown locked) > values saved on `/settings` (table `setting`, AES-256-GCM with a key derived from the login secret) > auto-setup. Field list in `definitions.ts`; every key must also exist in `env.ts`. Clients are built with `perSettings(build)`, which rebuilds after a save (`settingsVersion`), so changes apply without restart; module state tied to a config (Synology session, caches) must be created inside `perSettings` too. Never send saved secrets to the browser.
- **Proxmox wizard** (`proxmox/connect.ts`): one admin login creates `safehub@pve` (no password) and token `safehub` (privsep 0, so the user's ACL applies: PVEAuditor, plus PVEVMUser if allowed) and saves the token. The admin password is never stored or logged.
- **Update notice** (`lib/update.ts`): `SAFEHUB_BUILT_AT` (set in `next.config.ts` at build) vs the latest commit date on GitHub `main`, checked once a week while running and once after each start (1 h retry after a failure), off with `DISABLE_UPDATE_CHECK`. It is SafeHub's only outgoing request of its own; keep it that way.
- **Auto-setup** (`discovery.ts`): app config folders mounted read-only at `./appdata/<name>` are read once at startup (`config.xml` for Sonarr/Radarr/Prowlarr, `config/config.yaml` for Bazarr, `settings.json` for Seerr). The folder name is the host (`http://<name>:<port><urlBase>`). Adapters call `resolveService(app, env URL, env key)`: explicit settings win field by field. Tile links come only from explicit URLs (container names do not work in a browser). Never log the keys.
- Synology uses its own client (`synology/index.ts`): API paths and versions come from `SYNO.API.Info` (DSM 6 serves login from `auth.cgi`, DSM 7 from `entry.cgi`; never hard-code a path). DSM session login (POST, shared in-flight login, re-login on expired session codes, 5 min backoff after a rejected login so DSM auto-block never bans the host).
- Expensive or repeated calls go through `cacheFor(ttl, fn)` (`../cache.ts`): shares one in-flight request between tabs, never caches failures.
- Schema mismatches (`ZodError`) show a short tile message; details are logged once on the server.
- CA certificate paths are checked at boot in `env.ts`.
- TLS for self-signed services (`tls.ts`, `createTlsAgent`): default is trust on first use. A certificate that verifies normally is accepted; otherwise the first fingerprint is pinned in the `cert_pin` table (id `<pinName>@host:port`) and a different one raises `CertificateChangedError`, which `errorResult` turns into `certificateChanged` so the card shows an Accept button (`components/certificate`). TLS session resumption is off so every connection shows its certificate. `*_CA_CERT_PATH` and `*_ALLOW_SELF_SIGNED` override per service.
- UI in `src/components/<service>/`: a Server Component card that renders `ok` and `error`, and returns `null` for `not-configured`, client components for buttons, and a `"use server"` actions file that calls `requireSession()`, validates input, then calls `refresh()`.
- **Hide what is not configured.** Each adapter exports a `<name>Configured` flag (`servicesConfigured` for the registry); `src/app/page.tsx` only renders cards whose flag is true, so unconfigured integrations never show, not even as a loading placeholder. With nothing configured the page shows one setup hint.
- The dashboard re-renders every 10 s via `<AutoRefresh>` (paused when the tab is hidden).

## Removed features

- Wake on LAN and the network scanner were removed on purpose (owner has no use for them); migrations `0004` and `0005` drop their tables. Without them SafeHub needs no host networking. Do not re-add either unless asked.

## Auth and database

- SQLite via `better-sqlite3` + `drizzle-orm`. Schema in `src/db/schema/`, migrations in `drizzle/` (committed). Migrations run automatically at server start (`src/instrumentation.ts`), only then: after `db:generate` during `npm run dev`, run `db:migrate` or restart, or queries fail with "no such column".
- Auth via `better-auth` with the `username` plugin: users log in with username + password, no email. better-auth core still needs a unique email, so accounts store `placeholderEmail(username)` (`<name>@users.safehub.invalid`); never show or use it. Config in `src/lib/auth.ts`.
- Passwords have no rules (any length, empty allowed; owner's choice). better-auth rejects empty passwords, so every password passes through `toStoredPassword()` (fixed prefix) before sign-up or sign-in. Any future password change/reset code must use it too. Login is only via the `signIn` Server Action; the HTTP `/sign-in/username` route is disabled.
- Sign-up is open only on first run (`/setup` creates the admin through `createFirstAdmin`, which serializes calls), then refused. Unused HTTP routes are disabled (`disabledPaths`): `/sign-up/email`, `/sign-in/email`, `/sign-in/username`, `/is-username-available` (would allow probing usernames).
- Failed sign-ins (`/sign-in/username`) are limited per username (5 per 15 min) plus a global cap, in better-auth hooks (they run for `auth.api` calls from Server Actions). Do not rely on IP-based limits: `X-Forwarded-For` is client-controlled without a proxy.
- `src/proxy.ts` (Next 16's renamed middleware) only does an optimistic cookie redirect. The real check is `requireSession()` from `src/lib/session.ts`: call it in every protected page, Route Handler and Server Action.
- Pages that read live DB state without `headers()`/`cookies()` must call `await connection()` so they are not prerendered at build time.

## Architecture rules

- **All integrations run server-side.** API keys, tokens and passwords never reach the browser. Use Route Handlers, Server Actions or Server Components to call home lab APIs.
- **One adapter per integration** under `src/lib/integrations/<name>/` (e.g. `proxmox`, `synology`, `sonarr`). Each adapter exposes typed functions and hides HTTP details. UI code never calls a service API directly.
- **Validate all external data** at the adapter boundary (response shapes) and at the action boundary (user input).
- **Fail soft.** A service being down must not break the dashboard. Every adapter returns a clear offline/error state; use timeouts on every request.
- **Self-signed certificates**: Proxmox and DSM often use self-signed certs. Handle TLS trust per integration (pinning by default, CA file or opt-out flag), never globally via `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Deployment

- **Web app, not native mobile.** Phones get it as an installable PWA. Native apps cannot do background monitoring and would hold every API key on the device.
- **Host: the Proxmox mini PC** (decided), inside the existing Docker guest (LXC or VM), never on the Proxmox host itself. Normal Docker networking: port 3000 mapped, and SafeHub can join the servarr stack's network to reach containers by name (`http://sonarr:8989`). The NAS stays a possible fallback host; the code does not depend on which one.
- **Zero-config start:** `compose.yaml` + `docker compose up -d` must be enough. Never add a setting the app cannot start without: the login secret is generated into `data/auth-secret`, `BETTER_AUTH_URL` is optional (unset means plain cookies, see `lib/auth.ts`), `.env` is optional (`required: false`), and `docker-entrypoint.sh` chowns `/app/data` then drops to PUID/PGID with `setpriv`. New settings need a safe default, or their feature is hidden until configured.
- **Docker:** `Dockerfile` builds Next's `output: "standalone"` server (Debian slim, healthcheck on `/api/health`, app runs unprivileged via the entrypoint). `compose.yaml` uses the published image `ghcr.io/lamonfly/safehub:latest`, mounts `./data` (SQLite + secret) and `./certs` (CA files, read-only), and takes settings from `environment:` or an optional `.env`. Paths in settings stay relative to `/app`. The build uses placeholder env values; real config is runtime-only. Copy any new runtime folder (like `drizzle/`) into the runner stage. `.sh` files and the Dockerfile keep LF endings (`.gitattributes`). Deploy steps and the settings table live in `README.md`; keep both in sync when adding env vars.
- **If the mini PC is down, the dashboard is down.** Keep the app small enough that moving it between hosts is easy.
- **Remote access via Tailscale/WireGuard** to the host. Never port-forward the app to the internet.

## Security

This app can power machines on/off and control services. Treat it as an admin tool.

- Require authentication on every page and API route. No anonymous access.
- Never expose it to the internet directly. Access via LAN, VPN or Caddy with auth.
- Destructive or disruptive actions (shutdown, stop VM, restart container) need an explicit confirmation in the UI.
- Secrets live in `.env.local` (gitignored) in development; in deployment in `compose.yaml` or `.env`. Keep `.env.example` updated with every variable name and no values.

## History and alerts

- `lib/metrics/sampler.ts` runs once a minute from `instrumentation.ts` (guarded on `globalThis`, never overlapping): `collect.ts` reads everything configured through the normal adapters, `store.ts` saves minute samples (7 days) and hourly avg/max (90 days), then `lib/alerts/rules.ts` updates alerts. Series names live in `metrics/series.ts`; renaming one starts a new history.
- better-sqlite3 binds JS numbers as REAL: every time-bucket expression must use `CAST(ts / bucket AS INTEGER)`.
- Alerts (`alert` table): one row per problem with start, end, peak, unread flag. Rules open on a sustained condition and close only below a lower threshold (hysteresis). Escalation to critical marks the alert unread again. Alerts for subjects that vanished (guest stopped) close only if their system answered; otherwise the system's "unreachable" alert covers it. Alerts of services or connections removed from the settings close on the next check. Thresholds are in `rules.ts`.
- UI: `Sparkline` (server SVG, no library) inside `UsageBar`; `/history/{synology | node/<n> | guest/<n>/<vmid>}` with Recharts (client component `history-chart.tsx`, colors from M3 CSS variables); `/alerts`; `OpenAlertsCard` on the dashboard; badge in `AppHeader` counting open alerts (red if any is critical); "unread" only highlights entries on /alerts. Times are formatted client-side (`LocalTime`) because the container runs in UTC. Helpers called from server components must not live in `"use client"` files.

## UI

- **Material Design 3.** Colors are M3 roles defined once in `src/app/globals.css` (light + dark) and used as Tailwind colors (`bg-surface-container-low`, `text-on-surface-variant`, `bg-primary` ...). Never use raw Tailwind palette colors (`red-500`) or ad-hoc grays. Font: Roboto.
- Build pages from `src/components/ui/`: `Card`/`Tile`, `Button` (filled, tonal, outlined, text, danger), `TextField`/`Checkbox`, `Banner`, `StatusDot`, `UsageBar`, `useConfirm()` (M3 dialog; never `window.confirm`). Pages use `AppHeader` + `PageBody`.
- **Mobile first.** Touch targets at least 48 px; content in one column on phones; no wide tables (use list rows that stack, see the Proxmox card); respect safe-area insets (`env(safe-area-inset-*)`); text inputs 16 px and `autoCapitalize="none"` for names/URLs. Check new screens at 390 px wide.
- **PWA:** `app/manifest.ts`, icons from `lib/app-icon.tsx` (`/icon`, `/apple-icon`, `/pwa-icon/*`). These and the manifest are public in `proxy.ts`.
- **Proxmox tree:** guests are grouped under their node; `proxmox/addresses.ts` gets guest IPv4s (LXC interfaces, VM guest agent; other virtual interfaces ignored; cached 5 min) and its Docker networks (`docker0`, `br-*` CIDRs); `placement.ts` puts a service under the guest whose LAN IP its URL host resolves to, or else whose Docker network contains that address (container-name URLs). An address inside the Docker networks of several guests is not guessed.

## Conventions

- Server Components by default; add `"use client"` only for interactivity.
- Polling/live data via client hooks with sensible intervals; avoid hammering service APIs.
- Keep components small; shared UI in `src/components/`.
- Write normal, descriptive names; no abbreviations.

## Tests and CI

- `.github/workflows/ci.yml`: on every push and PR runs lint, `npm run typecheck`, `npm test`, build and `npm run test:smoke`. Only on `main`, and only if that passed, it publishes `ghcr.io/lamonfly/safehub:latest` (+ `sha-<short>`). Never push a change that fails these locally.
- Tests run in separate processes, each with its own temporary database (`tests/support/setup.ts` also clears integration env vars so a developer's `.env.local` cannot leak in). Modules read env and the database at import: set `process.env` first, then `await import(...)` inside `beforeAll`. Use `tests/support/helpers.ts` for fake HTTP/HTTPS services and throwaway certificates (`selfsigned`); never commit keys or certificates.
- Add a test with every behaviour change: pure logic next to the code (`*.test.ts`), cross-cutting checks in `tests/`. `tests/client-boundary.test.ts` enforces that `"use client"` files export only components and hooks. New pages go into the smoke test's list in `scripts/smoke-test.mts`.

## Git

- Commit messages and PR descriptions must not contain AI attribution: no `Co-Authored-By: Claude …` trailer, no "Generated with Claude Code" line. This overrides any default attribution.
