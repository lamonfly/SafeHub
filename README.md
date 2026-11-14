# SafeHub

Self-hosted dashboard for a home lab. One page to see and control your servers and services and scan your network. Runs as a single Docker container on your LAN.

## Features

- **Proxmox:** node CPU, RAM and uptime; VMs and LXCs with start, shut down, reboot, force stop and resume (destructive actions ask first).
- **Synology:** CPU, RAM, volume usage, disk health and temperatures. Works with DSM 6 and 7.
- **Services:** status, version and key numbers for Sonarr, Radarr, Prowlarr, Bazarr, Jellyfin, Seerr (Jellyseerr/Overseerr), Immich and Caddy. Health warnings show on each tile.
- **Network scanner:** finds hosts (IP, MAC, vendor, hostname), scans ports with names for common home lab services and flags new devices.
- **Fails soft:** an unconfigured or unreachable service shows its own error; the rest of the dashboard keeps working.
- **Single admin login**, SQLite storage, no external services or telemetry.

Built with Next.js, better-auth, Drizzle (SQLite) and Tailwind CSS.

## Security

> [!WARNING]
> SafeHub is an admin tool. Whoever logs in can shut down VMs and scan your network, and the server holds API keys and passwords for all connected services. Treat access to it like root access to your home lab.

- **Never expose it to the internet.** No port forwarding. For remote access use a VPN such as Tailscale or WireGuard.
- **Pick a real password.** SafeHub lets the password be anything, including empty, for convenience on a trusted LAN. Anyone who can reach the login page and guesses the username gets full control. Failed logins are limited (5 per 15 minutes per username), which slows guessing but does not replace a password.
- **Give every API key the least rights it needs:** a Proxmox token with only `PVEAuditor` (plus `PVEVMUser` if you want the buttons), a dedicated Synology user, never your personal accounts.
- **Keep your keys private.** Whichever file holds them (`compose.yaml` or `.env`): `chmod 600`, never commit it, never paste it into issues. `.env` is gitignored; a `compose.yaml` with keys is not.
- **Caddy's admin API has no authentication.** Only connect it if SafeHub runs on the same host and the API stays on `127.0.0.1`.
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

Settings are environment variables. Put them either under `environment:` in `compose.yaml` or in an optional `.env` file next to it; [`.env.example`](.env.example) lists every one with setup notes. After a change, apply it with `docker compose up -d` (a plain `restart` does not reload settings). Services without settings show as "not configured".

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

SafeHub must run on an always-on Linux machine on the same LAN as the machines it scans, for example a NAS or a VM/LXC on a Proxmox host. It uses host networking (the scanner needs it to see MAC addresses), so it listens directly on the host's port 3000 (set `PORT` to change it).

The container starts as root only to make `./data` writable, then runs SafeHub as `PUID`/`PGID` (default `1000`, set in `compose.yaml`).

**Paths:** keep every path in settings relative (`DATABASE_PATH=./data/safehub.db`, `PROXMOX_CA_CERT_PATH=./certs/pve-root-ca.pem`). The app runs in `/app` inside the container, where `./data` and `./certs` are mounted from the project folder, so the same values work in Docker and in development.

**Update:** `docker compose up -d --build` fetches the latest `main` from GitHub and restarts. Database migrations run automatically on start.

**Forgot the password:** there is no reset email. Delete the account and `/setup` opens again (scan history is kept):
```bash
sqlite3 data/safehub.db "DELETE FROM user;"
```

**Backup:** the `data` folder holds accounts, scan history and the login secret. Stop the container (`docker compose stop`) before copying it.

### Add to an existing Docker Compose stack

If you already run a Compose stack (for example Sonarr, Radarr, Prowlarr, Jellyseerr), add SafeHub as one more service. Its files stay in a `safehub/` folder next to your `compose.yaml`; Docker creates it on the first start.

Add to your `compose.yaml` under `services:`:

```yaml
  safehub:
    build:
      context: https://github.com/lamonfly/SafeHub.git#main
    image: safehub:latest
    container_name: safehub
    # Host networking: the scanner needs it for MAC addresses. SafeHub is
    # not on the stack's network, so it cannot use container names.
    network_mode: host
    env_file:
      - path: ./safehub/.env    # optional; keys can also go under environment:
        required: false
    environment:
      PUID: 1000
      PGID: 1000
      # SONARR_URL: http://127.0.0.1:8989
      # SONARR_API_KEY: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    # Relative paths in settings (./data/..., ./certs/...) resolve inside
    # /app, which these mounts map to ./safehub/data and ./safehub/certs.
    volumes:
      - ./safehub/data:/app/data
      - ./safehub/certs:/app/certs:ro
    restart: unless-stopped
```

In SafeHub's settings, point services on the same host at their **published** ports on `127.0.0.1` (host networking means "localhost" is the Docker host). Include any URL base you configured:

```bash
SONARR_URL=http://127.0.0.1:8989
RADARR_URL=http://127.0.0.1:7878
PROWLARR_URL=http://127.0.0.1:9696
BAZARR_URL=http://127.0.0.1:6767
SEERR_URL=http://127.0.0.1:5055
JELLYFIN_URL=http://127.0.0.1:8096
```

Services that only expose a port inside the stack network (no `ports:` entry) are not reachable from SafeHub; publish them, ideally on `127.0.0.1` only (e.g. `"127.0.0.1:8989:8989"`).

Start, update and logs:

```bash
docker compose up -d --build safehub     # first start, and after every update (pulls latest main)
docker compose logs -f safehub
```

**Caddy in the same stack:** keep its admin API private by publishing it on loopback only and allowing that origin:

```yaml
  caddy:
    # ...
    ports:
      - "127.0.0.1:2019:2019"
```

```
# Caddyfile, global options
{
	admin 0.0.0.0:2019 {
		origins 127.0.0.1:2019 localhost:2019
	}
}
```

Then set `CADDY_ADMIN_URL=http://127.0.0.1:2019` in SafeHub's settings. The admin API binds to all interfaces inside the Caddy container, but Docker only publishes it on the host's loopback.

### Synology NAS

- Needs Container Manager (DSM 7.2+, mostly x86 "plus" models).
- Easiest via SSH (Control Panel → Terminal & SNMP → enable SSH), then follow Quick start with `sudo docker compose ...` in e.g. `/volume1/docker/safehub`.
- Or in Container Manager → Project → Create, with the project folder as path and the existing `compose.yaml`.
- Port 5000/5001 are DSM's; keep SafeHub on 3000 or another free port.

### Proxmox

- Run Docker in a VM, or in an LXC with `nesting=1,keyctl=1` (Options → Features). The guest's network must be bridged to the LAN (`vmbr0`) so broadcasts reach other machines: `ip -4 addr` inside the guest should show a LAN address.
- Do not run it on the Proxmox host itself.
- Check that the port is free on the guest: `ss -ltnp | grep :3000`.

## Development

```bash
cp .env.example .env.local   # optional: service settings
npm install
npm run dev                  # http://localhost:3000
```

See `CLAUDE.md` for architecture and conventions. After changing the database schema: `npm run db:generate`, then `npm run db:migrate` (or restart the dev server).

## License

[MIT](LICENSE). Not affiliated with or endorsed by Proxmox, Synology, or the projects whose services SafeHub connects to; their names are trademarks of their respective owners.
