@AGENTS.md

# SafeHub

Self-hosted home server dashboard and monitor. One place to view, monitor and control everything on the home network.

## Goals

- **Dashboard**: status, health and key stats for every host and service.
- **Control**: start/stop/restart VMs, LXCs and containers; trigger service actions (scans, refreshes, requests).
- **Wake on LAN**: wake sleeping machines (NAS, mini PC, desktops) with magic packets.
- **Network scanner**: discover hosts on the LAN (IP, MAC, hostname, vendor) and scan open ports.
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
- **Caddy**: reverse proxy (admin API, default `localhost:2019`)

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
npm run db:generate  # create a migration after changing src/db/schema
npm run db:studio    # browse the database
```

## Integration pattern

Follow `src/lib/integrations/proxmox/` for every new service:

- `schemas.ts`: zod schemas for API responses and for action input (validate anything that ends up in a URL).
- `index.ts`: `server-only`. Builds config from `env` (null when unset), calls the API with `undici` `fetch` + per-service TLS agent (`../tls.ts`) + timeout, returns `IntegrationResult<T>` (`../result.ts`): `ok` / `not-configured` / `error`. Never throws to the caller.
- UI in `src/components/<service>/`: a Server Component card that renders all three states, client components for buttons, and a `"use server"` actions file that calls `requireSession()`, validates input, then calls `refresh()`.
- The dashboard re-renders every 10 s via `<AutoRefresh>` (paused when the tab is hidden).

## Network features

- `src/lib/net/`: shared helpers. `ip.ts` (private-range and hostname checks), `probe.ts` (TCP connect probe: connected or refused = online, timeout = offline). Reuse these for the scanner.
- `src/lib/net/`: also `subnet.ts` (CIDR math, local subnets), `arp.ts` (neighbor cache: `/proc/net/arp` on Linux, `arp -a` elsewhere), `vendor.ts` (MAC vendor via `oui-data`, kept out of the bundle by `serverExternalPackages`), `ports.ts` (discovery ports, named top ports, port list parser).
- `src/lib/scanner/`: TCP connect discovery plus ARP cache, reverse DNS, port scans. One scan at a time (in-process lock). Ranges are private only, /22 at most. Results in `scan_run` and `network_host` (keyed by MAC, or `ip:<addr>` when no MAC). UI at `/scanner`.
- `src/lib/wol/`: magic packets via `node:dgram`, devices stored in the `wol_device` table, managed at `/settings/wol`. Broadcast targets are limited to `255.255.255.255` or private addresses.

## Auth and database

- SQLite via `better-sqlite3` + `drizzle-orm`. Schema in `src/db/schema/`, migrations in `drizzle/` (committed). Migrations run automatically at server start (`src/instrumentation.ts`).
- Auth via `better-auth` (email + password), config in `src/lib/auth.ts`. Sign-up is open only on first run (`/setup` creates the admin), then refused.
- `src/proxy.ts` (Next 16's renamed middleware) only does an optimistic cookie redirect. The real check is `requireSession()` from `src/lib/session.ts`: call it in every protected page, Route Handler and Server Action.
- Pages that read live DB state without `headers()`/`cookies()` must call `await connection()` so they are not prerendered at build time.

## Architecture rules

- **All integrations run server-side.** API keys, tokens and passwords never reach the browser. Use Route Handlers, Server Actions or Server Components to call home lab APIs.
- **One adapter per integration** under `src/lib/integrations/<name>/` (e.g. `proxmox`, `synology`, `sonarr`). Each adapter exposes typed functions and hides HTTP details. UI code never calls a service API directly.
- **Validate all external data** at the adapter boundary (response shapes) and at the action boundary (user input, IPs, port ranges, MAC addresses).
- **Fail soft.** A service being down must not break the dashboard. Every adapter returns a clear offline/error state; use timeouts on every request.
- **Self-signed certificates**: Proxmox and DSM often use self-signed certs. Handle TLS trust per integration (custom CA or explicit opt-in flag), never globally via `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **Network features need LAN access.** Wake on LAN (UDP broadcast) and ARP-level scanning only work when the server runs on the same L2 network with host networking (no Docker bridge).
- **Privileged operations** (raw sockets, nmap SYN scans) need elevated rights. Prefer unprivileged TCP connect scans by default.

## Deployment

- **Web app, not native mobile.** Phones get it as an installable PWA. Native apps cannot do background monitoring, are blocked from ARP/MAC scanning, and would hold every API key on the device.
- **Host: an always-on LAN machine.** Either the Synology NAS (Container Manager) or the Proxmox mini PC (LXC/VM). Both run 24/7. Ship as a Docker image with `network_mode: host`.
- **The host cannot wake itself.** SafeHub can wake the other machine, not the one it runs on. If the host is down, the dashboard is down. Keep the app small enough that moving it between hosts is easy.
- **Remote access via Tailscale/WireGuard** to the host. Never port-forward the app or WoL to the internet. Remote WoL works because the phone talks to SafeHub, and SafeHub sends the broadcast on the LAN.
- **Power loss:** WoL cannot recover from an outage. Machines rely on BIOS/DSM "power on after AC loss".

## Security

This app can power machines on/off and control services. Treat it as an admin tool.

- Require authentication on every page and API route. No anonymous access.
- Never expose it to the internet directly. Access via LAN, VPN or Caddy with auth.
- Destructive or disruptive actions (shutdown, stop VM, restart container) need an explicit confirmation in the UI.
- Restrict scanner targets to private ranges (RFC 1918) by default.
- Secrets live in `.env.local` (gitignored). Keep `.env.example` updated with every variable name and no values.

## Conventions

- Server Components by default; add `"use client"` only for interactivity.
- Polling/live data via client hooks with sensible intervals; avoid hammering service APIs.
- Keep components small; shared UI in `src/components/`.
- Write normal, descriptive names; no abbreviations.
