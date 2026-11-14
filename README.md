# SafeHub

Self-hosted dashboard for a home lab. One page to see and control your servers and services. Runs as a single Docker container on your LAN.

## Features

- **Proxmox:** node CPU, RAM and uptime; VMs and LXCs with start, shut down, reboot, force stop and resume (destructive actions ask first).
- **Synology:** CPU, RAM, volume usage, disk health and temperatures. Works with DSM 6 and 7.
- **Services:** status, version and key numbers for Sonarr, Radarr, Prowlarr, Bazarr, Jellyfin, Seerr (Jellyseerr/Overseerr), Immich and Caddy. Health warnings show on each tile.
- **Fails soft:** an unconfigured or unreachable service shows its own error; the rest of the dashboard keeps working.
- **Single admin login**, SQLite storage, no external services or telemetry.

Built with Next.js, better-auth, Drizzle (SQLite) and Tailwind CSS.

## Security

> [!WARNING]
> SafeHub is an admin tool. Whoever logs in can shut down VMs, and the server holds API keys and passwords for all connected services. Treat access to it like root access to your home lab.

- **Never expose it to the internet.** No port forwarding. For remote access use a VPN such as Tailscale or WireGuard.
- **Pick a real password.** SafeHub lets the password be anything, including empty, for convenience on a trusted LAN. Anyone who can reach the login page and guesses the username gets full control. Failed logins are limited (5 per 15 minutes per username), which slows guessing but does not replace a password.
- **Give every API key the least rights it needs:** a Proxmox token with only `PVEAuditor` (plus `PVEVMUser` if you want the buttons), a dedicated Synology user, never your personal accounts.
- **Keep your keys private.** Whichever file holds them (`compose.yaml` or `.env`): `chmod 600`, never commit it, never paste it into issues. `.env` is gitignored; a `compose.yaml` with keys is not.
- **Caddy's admin API has no authentication.** Only connect it when Caddy and SafeHub share a Docker network and the API has no published port (see below).
- **Prefer certificate checks.** Use the `*_CA_CERT_PATH` options; `*_ALLOW_SELF_SIGNED=true` keeps traffic encrypted but cannot detect an impostor on your LAN.

Found a security issue? Please report it privately through GitHub's "Report a vulnerability" (Security tab) instead of opening a public issue.

## Quick start

On an always-on Linux machine in your LAN with Docker Compose 2.24 or newer:

```bash
mkdir safehub && cd safehub
curl -fsSL -O https://raw.githubusercontent.com/lamonfly/SafeHub/main/compose.yaml
docker compose up -d
```

The first start builds the image from GitHub (a few minutes). Then open `http://<machine IP>:3000` and create your account on `/setup`. Everything else is automatic: the `data` folder and its permissions, the login secret (`data/auth-secret`) and the database. Add services whenever you like (next section).

## Settings and credentials

Settings are environment variables. Put them either under `environment:` in `compose.yaml` or in an optional `.env` file next to it; [`.env.example`](.env.example) lists every one with setup notes. After a change, apply it with `docker compose up -d` (a plain `restart` does not reload settings). Anything without settings is simply hidden from the dashboard.

| What | Create it in | Setting | Notes |
|------|-------------|---------|-------|
| SafeHub account (username + password) | SafeHub, `/setup` page | Stored in the database | First visit. Sign-up closes afterwards. No email needed. |
| Login secret | Automatic (`data/auth-secret`) | `BETTER_AUTH_SECRET` (optional) | Only set it to choose your own. Changing it signs everyone out. |
| HTTPS address (optional) | Your reverse proxy, e.g. Caddy | `BETTER_AUTH_URL=https://safehub.example.lan` | Only when SafeHub is served over HTTPS: enables Secure cookies. Leave unset for plain `http://<IP>:3000`. |
| Proxmox API token | Proxmox UI: Datacenter → Permissions → API Tokens | `PROXMOX_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET` | The secret is shown only once. |
| Proxmox CA certificate | Copy `/etc/pve/pve-root-ca.pem` from the Proxmox host into `./certs/` | `PROXMOX_CA_CERT_PATH=./certs/pve-root-ca.pem` | Or `PROXMOX_ALLOW_SELF_SIGNED=true` |
| Synology user + password | DSM: Control Panel → User. Dedicated user, in `administrators`, 2FA off, all apps denied | `SYNOLOGY_URL`, `SYNOLOGY_USERNAME`, `SYNOLOGY_PASSWORD` | DSM 6 and 7 |
| Sonarr / Radarr / Prowlarr / Bazarr API keys | Each app: Settings → General → API Key | `<APP>_URL`, `<APP>_API_KEY` | |
| Jellyfin API key | Jellyfin: Dashboard → API Keys → + | `JELLYFIN_URL`, `JELLYFIN_API_KEY` | |
| Seerr API key | Seerr: Settings → General → API Key | `SEERR_URL`, `SEERR_API_KEY` | |
| Immich API key | Immich (as admin): Account Settings → API Keys | `IMMICH_URL`, `IMMICH_API_KEY` | |
| Caddy admin address | Caddyfile global `admin` option | `CADDY_ADMIN_URL` | Read the warning in `.env.example` first. |

**Keys in `compose.yaml` or `.env`?** Both work. If `compose.yaml` holds keys, treat it like a secret file: `chmod 600 compose.yaml`, and never commit or share it. Write a literal `$` in a value as `$$`, because Compose reads `$` as a variable. A separate `.env` keeps keys out of a file you may want to share or put in git.

## Deploy (Docker)

SafeHub runs on any always-on Linux machine with Docker that can reach your services, for example a NAS or a VM/LXC on a Proxmox host. It listens on port 3000; change the left side of `ports:` in `compose.yaml` to use another host port.

The container starts as root only to make `./data` writable, then runs SafeHub as `PUID`/`PGID` (default `1000`, set in `compose.yaml`).

**Paths:** keep every path in settings relative (`DATABASE_PATH=./data/safehub.db`, `PROXMOX_CA_CERT_PATH=./certs/pve-root-ca.pem`). The app runs in `/app` inside the container, where `./data` and `./certs` are mounted from the project folder, so the same values work in Docker and in development.

**Update:** `docker compose up -d --build` fetches the latest `main` from GitHub and restarts. Database migrations run automatically on start.

**Forgot the password:** there is no reset email. Delete the account and `/setup` opens again (nothing else is lost):
```bash
sqlite3 data/safehub.db "DELETE FROM user;"
```

**Backup:** the `data` folder holds the account database and the login secret. Stop the container (`docker compose stop`) before copying it.

### Add to an existing Docker Compose stack

If you already run a Compose stack (for example Sonarr, Radarr, Prowlarr, Jellyseerr), add SafeHub as one more service. It then shares the stack's network and reaches the other containers by name, with no extra published ports. Its files stay in a `safehub/` folder next to your `compose.yaml`; Docker creates it on the first start.

Add to your `compose.yaml` under `services:` (the full list of settings is in the repo's [`compose.yaml`](compose.yaml)):

```yaml
  safehub:
    build:
      context: https://github.com/lamonfly/SafeHub.git#main
    image: safehub:latest
    container_name: safehub
    ports:
      - "3000:3000"
    env_file:
      - path: ./safehub/.env    # optional; keys can also go under environment:
        required: false
    environment:
      PUID: 1000
      PGID: 1000
      # Same stack: use the service names and their internal ports.
      # SONARR_URL: http://sonarr:8989
      # SONARR_API_KEY: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    # Relative paths in settings (./data/..., ./certs/...) resolve inside
    # /app, which these mounts map to ./safehub/data and ./safehub/certs.
    volumes:
      - ./safehub/data:/app/data
      - ./safehub/certs:/app/certs:ro
    restart: unless-stopped
```

Use each service's **name in the compose file** and its **internal port** (the right side of its `ports:` entry, or the app's default), plus any URL base you configured:

```bash
SONARR_URL=http://sonarr:8989
RADARR_URL=http://radarr:7878
PROWLARR_URL=http://prowlarr:9696
BAZARR_URL=http://bazarr:6767
SEERR_URL=http://jellyseerr:5055
JELLYFIN_URL=http://jellyfin:8096
```

Services on other machines (Proxmox, Synology, anything outside this stack) use their LAN address as usual.

Start, update and logs:

```bash
docker compose up -d --build safehub     # first start, and after every update (pulls latest main)
docker compose logs -f safehub
```

**SafeHub in its own folder** (Quick start) can still use container names: uncomment the `networks:` lines at the bottom of its `compose.yaml` and set the stack's network name (`docker network ls`, usually `<folder>_default`). Otherwise use the LAN address and published port of each service.

**Caddy in the same stack:** SafeHub reaches Caddy's admin API over the stack network, so the API never needs a published port. Let it listen inside the container and accept that address:

```
# Caddyfile, global options
{
	admin 0.0.0.0:2019 {
		origins caddy:2019
	}
}
```

Then set `CADDY_ADMIN_URL=http://caddy:2019`. Do not add `2019` to Caddy's `ports:`. Note that every container on that network can reach the admin API, which has no authentication.

### Synology NAS

- Needs Container Manager (DSM 7.2+, mostly x86 "plus" models).
- Easiest via SSH (Control Panel → Terminal & SNMP → enable SSH), then follow Quick start with `sudo docker compose ...` in e.g. `/volume1/docker/safehub`.
- Or in Container Manager → Project → Create, with the project folder as path and the existing `compose.yaml`.
- Port 5000/5001 are DSM's; keep SafeHub on 3000 or another free port.

### Proxmox

- Run Docker in a VM, or in an LXC with `nesting=1,keyctl=1` (Options → Features). Give the guest a LAN address (bridge `vmbr0`) so you can open SafeHub from other devices.
- Do not run it on the Proxmox host itself.
- Check that the host port is free on the guest: `ss -ltnp | grep :3000`.

## Development

```bash
cp .env.example .env.local   # optional: service settings
npm install
npm run dev                  # http://localhost:3000
```

See `CLAUDE.md` for architecture and conventions. After changing the database schema: `npm run db:generate`, then `npm run db:migrate` (or restart the dev server).

## License

[MIT](LICENSE). Not affiliated with or endorsed by Proxmox, Synology, or the projects whose services SafeHub connects to; their names are trademarks of their respective owners.
