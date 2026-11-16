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
- `index.ts`: `server-only`. Builds a client from `env` (null when unset) with `createHttpClient` (`../http.ts`: base URL, auth headers, per-service TLS agent from `../tls.ts`, 5 s timeout, zod-parsed JSON). Requests never follow a redirect to another origin (`fetchWithoutLeaks`: key headers would go along, e.g. to a login portal); that is an error naming only the target origin (same host name, other scheme or port: "use that address in the settings"). Same-origin GET redirects are followed; other methods never follow a redirect. Own fetch code (qBittorrent, the Proxmox wizard, DSM) uses `fetchWithoutLeaks` too, so passwords and session ids never reach a redirect target. Public functions return `IntegrationResult<T>` (`../result.ts`): `ok` / `not-configured` / `error`; wrap with `attempt()`. Never throw to the caller.
- Small adapters can keep their schemas inline in `index.ts`.
- **qBittorrent** (`qbittorrent/`) has its own `HttpClient`: form login with a session cookie (`SID` or `QBT_SID_<port>`), one shared re-login on 403, login skipped without a username. Login blocks live outside `perSettings`, keyed by a hash of URL + account (saving another setting keeps them): a rejected password ("Fails." or 401) stops logins until the credentials change (qBittorrent bans IPs), a 403 ban waits 5 min, a 5xx or network error is an ordinary error retried on the next refresh. The summary only fetches `torrents/info?filter=downloading` and `?filter=errored`, not the whole library. Pause/resume all try the v5 `stop`/`start` routes, then v4 `pause`/`resume`. **Gluetun** (`gluetun/`) reads the control server with `X-API-Key`; a VPN that is not `running` throws, so the generic `service:gluetun:up` alert covers it. `getForwardedPort` reads `/v1/portforward`, falling back to `/v1/openvpn/portforwarded` on 404 (port 0 = none). With both configured, the qBittorrent tile warns when `listen_port` (`app/preferences`) differs from the forwarded port, its "Use VPN port" action (confirms; `ServiceAction.available` hides it without Gluetun) sets it via `app/setPreferences` (`json={"listen_port":N}`, 1-65535), and `getPortForwardMismatch()` feeds the alert.
- Simple status services (\*arr, Bazarr, Jellyfin, Seerr, Immich, qBittorrent, Gluetun) return a `ServiceSummary` (version, stats, issues) and are registered in `src/lib/integrations/services.ts`; the dashboard's Services card renders that list. Each service's summary is cached 5 s on its own (`getServiceStatus(key)`; `getServiceStatuses()` for all); a service action drops that service's cache. Adding a service = adapter + one registry line + env vars.
- **Service actions:** a registry entry can list `actions` (`ServiceAction`: id, label, optional `confirm` text for heavy work, `run(client)` returning a short result). Only id/label/confirm reach the browser; `runServiceAction` looks the action up in the registry (Server Action `components/services/actions.ts`). `HttpClient.post(path, schema, body?, { acceptStatuses })` sends JSON; `acceptStatuses` parses listed error answers (Prowlarr `indexer/testall` returns 400 with the results when any indexer fails). Seerr's pending requests (`getSeerrPendingRequests`, newest 10, titles from `movie`/`tv` cached per settings) show in its tile with Approve and Decline (decline confirms).
- **Settings** (`src/lib/settings/`): integration settings come from `getSetting(key)` / `getFlag(key)`, never from `env` directly. Order: env (compose.yaml / .env, shown locked) > values saved on `/settings` (table `setting`, AES-256-GCM with a key derived from the login secret; `v2:` rows bind the setting key as AAD, `v1:` rows are read and upgraded on load) > auto-setup. Field list in `definitions.ts`; every key must also exist in `env.ts`. Clients are built with `perSettings(build)`, which rebuilds after a save (`settingsVersion`), so changes apply without restart; module state tied to a config (Synology session, caches) must be created inside `perSettings` too. Never send saved secrets to the browser. URL values (env and saved) go through `httpUrl` (`lib/url.ts`): http/https only, no `user:pass@`. Secret fields are saved exactly as typed (never trimmed).
- **Proxmox wizard** (`proxmox/connect.ts`): one admin login creates `safehub@pve` (no password), sets its ACL first (PVEAuditor, guest agent role, plus PVEVMUser if allowed), then creates a new token (`safehub`, or `safehub-<time>` next to an existing one; privsep 0, so the user's ACL applies). The action saves it and only then calls `removeOldTokens()`, so a failure leaves the old token working; if saving fails it calls `removeNewToken()`. Only a 400 naming the unknown privilege counts as PVE 8 for the guest agent role; any other failure stops the wizard. The admin password is never stored or logged.
- **Update notice** (`lib/update.ts`): `SAFEHUB_BUILT_AT` (set in `next.config.ts` at build) vs the latest commit date on GitHub `main`, checked once a week while running and once after each start (1 h retry after a failure), off with `DISABLE_UPDATE_CHECK`. Apart from ntfy notifications the user configures, it is SafeHub's only outgoing request of its own; keep it that way.
- **Auto-setup** (`discovery.ts`): app config folders mounted read-only at `./appdata/<name>` are read once at startup (`config.xml` for Sonarr/Radarr/Prowlarr, `config/config.yaml` for Bazarr, `settings.json` for Seerr). The folder name is the host (`http://<name>:<port><urlBase>`). Adapters call `resolveService(app, env URL, env key)`: explicit settings win field by field. Tile links come only from explicit URLs (container names do not work in a browser). Never log the keys.
- Synology uses its own client (`synology/index.ts`): API paths and versions come from `SYNO.API.Info` (DSM 6 serves login from `auth.cgi`, DSM 7 from `entry.cgi`; never hard-code a path). DSM session login (POST, shared in-flight login, re-login on expired session codes, 5 min backoff after a rejected login so DSM auto-block never bans the host).
- Expensive or repeated calls go through `cacheFor(ttl, fn)` (`../cache.ts`): shares one in-flight request between tabs, never caches failures.
- Schema mismatches (`ZodError`) show a short tile message; details are logged once on the server.
- CA certificate paths are checked at boot in `env.ts`.
- TLS for self-signed services (`tls.ts`, `createTlsAgent`): default is trust on first use. A certificate that verifies normally is accepted; otherwise the first fingerprint is pinned in the `cert_pin` table (id `<pinName>@host:port`) and a different one raises `CertificateChangedError`, which `errorResult` turns into `certificateChanged` so the card shows an Accept button (`components/certificate`). `acceptCertificate` only pins the fingerprint that pin last presented (kept in memory when the error is raised), never one the browser picks. TLS session resumption is off so every connection shows its certificate. `*_CA_CERT_PATH` and `*_ALLOW_SELF_SIGNED` override per service.
- UI in `src/components/<service>/`: a Server Component card that renders `ok` and `error`, and returns `null` for `not-configured`, client components for buttons, and a `"use server"` actions file that calls `requireSession()`, validates input, then calls `refresh()`.
- **Hide what is not configured.** Each adapter exports a `<name>Configured` flag (`servicesConfigured` for the registry); `src/app/page.tsx` only renders cards whose flag is true, so unconfigured integrations never show, not even as a loading placeholder. With nothing configured the page shows one setup hint.
- The dashboard re-renders every 10 s via `<AutoRefresh>` (paused when the tab is hidden).
- **Backups** (`proxmox/backups.ts`): newest backup per vmid from every backup storage's content (`nodes/<n>/storage?content=backup`) plus the latest finished `vzdump` task per node from `cluster/tasks` (`OK`/`WARNINGS` = success). Storages are listed in parallel with a 30 s timeout; a failing storage lands in `failedStorages` (no guest is then overdue, and the sampler skips backups that round). Read through `createBackupReader`: cached 10 min, a failure is retried after 3 min, and the overview waits at most 1.5 s (last known result meanwhile, but only while it is younger than 20 min); failures leave `backups: null` and never fail the overview. Guests get `backupAgeMs` (null = never, undefined = unknown) and `backupOverdue` (`PROXMOX_BACKUP_MAX_AGE_DAYS`, default 7). Never-backed-up guests do not alert.
- **Check setup** (`/diagnostics`, `lib/diagnostics/run.ts`, linked from Settings): runs the real checks (Proxmox version, token rights on `/` via `access/permissions`, guest addresses, backups, Synology, Docker socket and host, services with resolved host and placement, auto-setup, ntfy) and builds a copyable plain-text report. Never put keys, tokens or passwords in it.

## Removed features

- Wake on LAN and the network scanner were removed on purpose (owner has no use for them); migrations `0004` and `0005` drop their tables. Without them SafeHub needs no host networking. Do not re-add either unless asked.

## Auth and database

- SQLite via `better-sqlite3` + `drizzle-orm`. Schema in `src/db/schema/`, migrations in `drizzle/` (committed). Migrations run automatically at server start (`src/instrumentation.ts`), only then: after `db:generate` during `npm run dev`, run `db:migrate` or restart, or queries fail with "no such column".
- Auth via `better-auth` with the `username` plugin: users log in with username + password, no email. better-auth core still needs a unique email, so accounts store `placeholderEmail(username)` (`<name>@users.safehub.invalid`); never show or use it. Config in `src/lib/auth.ts`.
- Passwords have no rules (any length, empty allowed; owner's choice). better-auth rejects empty passwords, so every password passes through `toStoredPassword()` (fixed prefix) before sign-up or sign-in. Any future password change/reset code must use it too. Login is only via the `signIn` Server Action; the HTTP `/sign-in/username` route is disabled.
- Sign-up is open only on first run (`/setup` creates the admin through `createFirstAdmin`, which serializes calls), then refused. The browser uses no better-auth HTTP route: every one except `USED_HTTP_ROUTES` (`/get-session`, `/sign-out`, `/ok`, `/error`) answers 404 via the `onlyUsedRoutes` plugin in `lib/auth.ts` (also covers parameter routes and routes added by future versions), and `disabledPaths` names the sensitive ones explicitly (sign-up, sign-in, `/is-username-available`, password change/reset, user update/delete, email, social accounts, sessions). Keep it that way when adding auth features.
- Failed sign-ins (`/sign-in/username`) are limited per username (5 per 15 min) plus a global cap, in better-auth hooks (they run for `auth.api` calls from Server Actions). The `before` hook counts each attempt as failed in the same step as the check (parallel attempts cannot slip through); success refunds it in `after`. Do not rely on IP-based limits: `X-Forwarded-For` is client-controlled without a proxy.
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

- `lib/metrics/sampler.ts` runs once a minute from `instrumentation.ts` (guarded on `globalThis`, never overlapping; `createSampler(parts)` for tests): `collect.ts` reads everything configured through the normal adapters, `store.ts` saves minute samples (7 days) and hourly avg/max (90 days), then `lib/alerts/rules.ts` updates alerts. A round that does not finish within 50 s is given up (its late result is dropped) so a hung request cannot stop sampling. Roll-up and pruning run hourly at the start of every tick, independent of the round. Each part of `collect()` (Synology, Proxmox, Docker, services, port check) runs on its own (`runPart`): a part that throws loses only its readings, is logged once per message, counts its system as down (with the error) and lands in `Snapshot.failed`, whose alerts then stay as they are. Series names live in `metrics/series.ts`; renaming one starts a new history. `knownSeries(prefix)` uses a key range (not LIKE).
- better-sqlite3 binds JS numbers as REAL: every time-bucket expression must use `CAST(ts / bucket AS INTEGER)`.
- Alerts (`alert` table): one row per problem with start, end, peak, unread flag. Rules open on a sustained condition and close only below a lower threshold (hysteresis). Escalation to critical marks the alert unread again. Alerts for subjects that vanished (guest stopped) close only if their system answered; otherwise the system's "unreachable" alert covers it. Alerts of services or connections removed from the settings close on the next check, including all Synology / Proxmox child alerts (`Snapshot.configured`). `lastValues(series, n, now)` only counts samples from the last n minutes; "up" alerts close after two good samples in a row; their title names the cause of the latest failure (`alerts/failure.ts` `describeFailure`, from the `IntegrationResult` error: login rejected, certificate changed, unexpected response (API changed?), wrong URL, VPN not running, else unreachable) while the key stays the series name. Synology disks alert only on clearly bad states (crash/fail/degrad/critical ... critical, warning/abnormal/attention warning; new, unused or uninitialized disks do not), volumes as `volume:synology:<name>` (degraded/crashed critical, attention/read-only warning). `qbittorrent:port-mismatch` (warning) opens after 3 samples of series `qbittorrent:port-forward` = 0 (`getPortForwardMismatch`: qBittorrent's listening port differs from Gluetun's forwarded one), closes after 2 good samples or when qBittorrent/Gluetun is no longer configured; a failed check stores nothing and keeps it. Backup alerts (`backup:<node>/<vmid>`, `backup-job:<node>`) stay as they are in rounds without backup data. Thresholds are in `rules.ts`.
- Notifications (`lib/notifications/ntfy.ts`): `evaluateAlerts` returns change events (opened / escalated / resolved); the sampler passes them to `notify()`, which publishes to ntfy as JSON (priority 5 critical, 4 warning, 3 resolved; more than 4 in a round become a summary; optional critical-only). Opt-in via `NTFY_TOPIC`; failures are logged, never thrown. The sampler passes a "still current" check that `notify` asks before each push, so a round given up by the watchdog stops sending. Nothing is sent for an alert muted on /alerts (`alert.muted_until`: 1 h / 8 h / 24 h, or `ALERT_MUTED_UNTIL_RESOLVED`), including its escalation and resolution, and nothing at all during a maintenance pause (`notification_pause` table, one row, 1 h / 4 h / 24 h, shown on /alerts and in Settings); skipped events are not sent later. Events carry `key` and `mutedUntil`. Works with ntfy.sh or the optional self-hosted `ntfy` service in `compose.yaml` (Android, `deny-all` auth, SafeHub uses a write-only token; README "Own ntfy server"). `checkNtfyServer()` (`/v1/health`) feeds Check setup. Settings has a test button (`components/settings/notification-test.tsx`).
- UI: `Sparkline` (server SVG, no library) inside `UsageBar`; `/history/{synology | node/<n> | guest/<n>/<vmid> | docker/<name>}` (parsed and validated in `metrics/history-target.ts`) with Recharts (client component `history-chart.tsx`, colors from M3 CSS variables); `/alerts`; `OpenAlertsCard` on the dashboard; badge in `AppHeader` counting open alerts (red if any is critical); "unread" only highlights entries on /alerts. Times are formatted client-side (`LocalTime`) because the container runs in UTC. Helpers called from server components must not live in `"use client"` files.

## UI

- **Material Design 3.** Colors are M3 roles defined once in `src/app/globals.css` (light + dark) and used as Tailwind colors (`bg-surface-container-low`, `text-on-surface-variant`, `bg-primary` ...). Never use raw Tailwind palette colors (`red-500`) or ad-hoc grays. Font: Roboto.
- Build pages from `src/components/ui/`: `Card`/`Tile`, `Button` (filled, tonal, outlined, text, danger), `TextField`/`Checkbox`, `Banner`, `StatusDot`, `UsageBar`, `useConfirm()` (M3 dialog; never `window.confirm`). Pages use `AppHeader` + `PageBody`.
- **Mobile first.** Touch targets at least 48 px; content in one column on phones; no wide tables (use list rows that stack, see the Proxmox card); respect safe-area insets (`env(safe-area-inset-*)`); text inputs 16 px and `autoCapitalize="none"` for names/URLs. Check new screens at 390 px wide.
- **PWA:** `app/manifest.ts`, icons from `lib/app-icon.tsx` (`/icon`, `/apple-icon`, `/pwa-icon/*`). These and the manifest are public in `proxy.ts`.
- **Proxmox tree:** guests are grouped under their node; `proxmox/addresses.ts` gets guest IPv4s (LXC interfaces, VM guest agent; other virtual interfaces ignored; cached 5 min; failures keep the last addresses and back off 30 s doubling to 10 min; the overview waits at most 1 s per lookup, a slower one finishes in the background) and its Docker networks (`docker0`, `br-*` CIDRs); `placement.ts` puts a service under the guest whose LAN IP its URL host resolves to (DNS via `createHostResolver`: 500 ms timeout, one lookup per host in flight, cached 60 s, failures 10 s), or else whose Docker network contains that address (container-name URLs). An address inside the Docker networks of several guests is not guessed. Services reached by a container or compose service name of the placed Docker host go under that guest (works for VMs without guest agent data). `lib/dashboard.ts` (`getServicePlacement`, React `cache` per request) computes placement once for both cards from the Proxmox overview (`getCachedProxmoxOverview`, 5 s shared cache, dropped after a guest action; the sampler and setup check use the uncached `getProxmoxOverview`), Docker and the services' hosts only (`getServiceInfos`, no service calls): placed services render under their guest as `ServiceSlot`s, each streaming its own data (`getServiceTile`) in its own Suspense boundary, so a slow service never holds up the tree. Placement waits at most 1.5 s for Proxmox and Docker (then the last answer, or nothing placed); the Proxmox card (`getDashboardLayout`) waits for the full answer and lists services placed under guests it does not show. The Services card keeps only unmatched ones and hides when empty (decided from placement; with Proxmox it has no loading placeholder). The connect wizard adds role `SafeHubGuestAgent` (`VM.GuestAgent.Audit`) because PVEAuditor cannot read guest agent addresses. Never fall back to `VM.Monitor` (PVE 8): it allows guest agent exec and file writes; on PVE 8 the role is skipped (and removed if left over), VM agent addresses stay hidden, LXC addresses still work.
- **Docker** (`integrations/docker/`): enabled only when the Docker socket is mounted (`/var/run/docker.sock`, path override `DOCKER_SOCKET`) and SafeHub may read and write it (`dockerSocketState`: `missing` / `no-access` / `ok`; a socket without access is hidden like a missing one, and Check setup says why); no setting, no proxy (owner's choice). `docker-entrypoint.sh` adds the socket's group to `setpriv`, except group 0 (warns instead; Docker then stays hidden). Lists `/containers/json?all=1`, `/info`, `/networks`; start/stop/restart via `runContainerAction` (Server Action `components/docker/actions.ts`, stop and restart confirm). SafeHub's own container (ID from `/proc/self/mountinfo`, else host name) gets no controls. `placeDockerHost` finds the guest by host name = guest name, then the full set of network gateways, then the address the dashboard was opened at. Chips under that guest open a dialog with details, port links (`http://<guest IP>:<port>`) and controls; unmatched, they show in a tile on the Proxmox card, and without Proxmox in `DockerCard`. Image updates are left to a dedicated tool (Watchtower, WUD), not SafeHub. Alerts (`rules.ts`, input from `collect.ts` `containerReadings`): series `docker:<name>:up` (1 running, 0 crashed: restarting, dead, out-of-memory kill, or an exit code other than 0/130/137/143; exit 137 is inspected once per container for `State.OOMKilled`) and `docker:<name>:health`; `docker:<name>:down` opens (critical) after 2 crashed samples, only if the container was seen running in the kept history (`hasValue`), and closes after 2 running samples or a clean stop; `docker:<name>:unhealthy` warns after 3 minutes; `docker:<name>:crash-loop` warns when the restart policy restarted it 3+ times in 15 minutes (`RestartCount` from inspect, read only for containers that are restarting or started under 2 minutes ago, cached 20 s; restarts counted in memory by `trackRestarts`), closes after 15 quiet minutes (without a count, e.g. after a SafeHub restart, a container up 15+ minutes per its status text, or stopped cleanly, counts as 0 restarts); `docker:up` covers the socket itself. History: the sampler reads `/containers/<id>/stats?stream=false&one-shot=true` for running containers (4 at a time, 5 s timeout, all within 15 s; late ones get no sample that round) into `docker:<name>:cpu` (share of the whole host, from the delta to the previous round since one-shot has no precpu) and `docker:<name>:memory` (usage minus inactive file cache, % of the limit or host memory); the container dialog links to `/history/docker/<name>`.

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

- Only commit or push when the user explicitly asks for it in their current message. Never commit or push on your own initiative, not even after finishing or fixing something, and not because an earlier message asked for a commit. Leave changes uncommitted and say so.
- Commit messages and PR descriptions must not contain AI attribution: no `Co-Authored-By: Claude …` trailer, no "Generated with Claude Code" line. This overrides any default attribution.
