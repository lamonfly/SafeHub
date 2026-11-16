# SafeHub

Self-hosted dashboard for a home lab. One page to see and control your servers and services. Runs as a single Docker container on your LAN.

## Features

- **Proxmox:** each node with its VMs and LXCs as a tree: CPU, RAM, uptime, IP address, and the services running on each guest, shown as full tiles under it (matched by IP, or by container name for apps in Docker on the machine SafeHub runs on; VMs need the QEMU guest agent). Services that match no guest stay in the Services card. Start, shut down, reboot, force stop and resume; destructive actions ask first.
- **Backups:** age of each guest's newest Proxmox backup (any backup storage, including the NAS or Proxmox Backup Server), with an alert when it is older than 7 days (configurable) or when the last backup job failed.
- **Synology:** CPU, RAM, volume usage, disk health and temperatures. Works with DSM 6 and 7.
- **Services:** status, version and key numbers for Sonarr, Radarr, Prowlarr, Bazarr, Jellyfin, Seerr (Jellyseerr/Overseerr) and Immich. Health warnings show on each tile. Sonarr, Radarr, Prowlarr, Bazarr and Seerr can set themselves up from their config folders. Buttons on the tiles: search missing and refresh (Sonarr, Radarr), test indexers (Prowlarr), scan libraries (Jellyfin). The Seerr tile lists pending requests with Approve and Decline.
- **Docker:** with the Docker socket mounted, the containers of the machine SafeHub runs on show under their Proxmox guest (or in their own card), with start, stop and restart.
- **History:** CPU, memory and disk usage of the NAS, Proxmox nodes and guests, and CPU and memory of each Docker container, recorded every minute. 24-hour trend lines on the dashboard; tap a name for charts over 24 hours, 7, 30 or 90 days.
- **Alerts:** checked every minute, kept for 90 days. CPU or memory above 90 % for 5 minutes, volumes above 85 % (critical at 95 %), disks or RAID volumes not healthy (degraded, crashed), services or machines not answering, with the cause when known (login rejected, certificate changed, unexpected response, VPN not running), backups overdue or failed, qBittorrent listening on another port than the one Gluetun forwards, Docker containers that crash, keep restarting (also crash loops where the container looks running) or report unhealthy (only containers SafeHub has seen running; stopping one on purpose is not an alert). Open problems show at the top of the dashboard; the bell counts current problems (it drops as soon as one is fixed), and the Alerts page lists when each problem started, how long it lasted and its peak.
- **Phone notifications:** alerts as push notifications through [ntfy](https://ntfy.sh) (public server or your own, see [Own ntfy server](#own-ntfy-server-optional)) when a problem starts, becomes critical or is resolved. Optional, critical-only if you like, with a test button. On the Alerts page you can mute one alert (1, 8 or 24 hours, or until resolved) or pause all notifications during planned maintenance (1, 4 or 24 hours); alerts are still recorded.
- **Settings page:** add and change services in the browser; no file editing or restart. Proxmox can be connected with an admin login: SafeHub creates its own limited user and token.
- **Check setup:** Settings → Check setup asks every configured system directly and lists what SafeHub sees (versions, token rights, guest addresses, where each service was placed, backups), with a copyable report that never contains keys.
- **Update notice:** a badge in the header when GitHub has a newer version.
- **Material Design 3, built for phones:** large touch targets, light and dark mode, installable as an app (Add to Home screen).
- **Fails soft:** an unconfigured or unreachable service shows its own error; the rest of the dashboard keeps working.
- **Single admin login**, SQLite storage, no telemetry. Its only outgoing requests of its own are the weekly update check to GitHub (can be turned off) and notifications to the ntfy server you choose.

Built with Next.js, better-auth, Drizzle (SQLite) and Tailwind CSS.

## Security

> [!WARNING]
> SafeHub is an admin tool. Whoever logs in can shut down VMs, and the server holds API keys and passwords for all connected services. Treat access to it like root access to your home lab.

- **Never expose it to the internet.** No port forwarding. For remote access use a VPN such as Tailscale or WireGuard.
- **Pick a real password.** SafeHub lets the password be anything, including empty, for convenience on a trusted LAN. Anyone who can reach the login page and guesses the username gets full control. Failed logins are limited (5 per 15 minutes per username), which slows guessing but does not replace a password.
- **Give every API key only the rights it needs:** a Proxmox token with `PVEAuditor` (read-only) and `VM.GuestAgent.Audit` for VM addresses (Proxmox VE 9; on Proxmox VE 8 that right does not exist and the wizard skips it, so VM addresses from the guest agent are not shown, container addresses still are), plus `PVEVMUser` if you want the buttons (that role is more than start/stop: it also allows console access, backups and CD-ROM changes on every guest); the Connect wizard sets exactly this up. Use a dedicated Synology user, never your personal accounts.
- **Keep your keys private.** Whichever file holds them (`compose.yaml` or `.env`): `chmod 600`, never commit it, never paste it into issues. `.env` is gitignored; a `compose.yaml` with keys is not.
- **Certificates are pinned on first use.** Proxmox and Synology usually have self-signed certificates. SafeHub trusts the certificate it sees on the first connection and refuses a different one later, like SSH does with host keys. If you renew or replace a certificate, the card shows its new fingerprint and an "Accept new certificate" button; accept only if you made that change. `*_ALLOW_SELF_SIGNED=true` turns this protection off for a service.

Found a security issue? Please report it privately through GitHub's "Report a vulnerability" (Security tab) instead of opening a public issue.

## Quick start

On an always-on Linux machine in your LAN with Docker Compose 2.24 or newer:

```bash
mkdir safehub && cd safehub
curl -fsSL -O https://raw.githubusercontent.com/lamonfly/SafeHub/main/compose.yaml
docker compose up -d
```

The first start downloads the image (built and tested by GitHub on every change). Then open `http://<machine IP>:3000`, create your account on `/setup`, and add your services under **Settings**. Everything else is automatic: the `data` folder and its permissions, the login secret (`data/auth-secret`) and the database.

## Automatic setup for Sonarr, Radarr, Prowlarr, Bazarr and Seerr

These apps keep their API key in their own config folder. Give SafeHub read-only access to those folders and it configures them itself: no keys to copy.

1. Mount each app's config folder (the one mapped to `/config`, or `/app/config` for Seerr) at `/app/appdata/<container name>`:
   ```yaml
       volumes:
         - ./data:/app/data
         - ../servarr/sonarr:/app/appdata/sonarr:ro
         - ../servarr/radarr:/app/appdata/radarr:ro
         - ../servarr/prowlarr:/app/appdata/prowlarr:ro
         - ../servarr/bazarr:/app/appdata/bazarr:ro
         - ../servarr/jellyseerr:/app/appdata/jellyseerr:ro
   ```
   The left side is wherever that folder lives on the host (relative to SafeHub's `compose.yaml`).
2. Put SafeHub on the same Docker network as those containers (same compose file, or the `networks:` lines in SafeHub's `compose.yaml`). The folder name is used as the address, e.g. `http://sonarr:8989`, so name it like the container.
3. `docker compose up -d`. The log lists what was found: `docker compose logs safehub | grep Auto-setup`.

SafeHub reads `config.xml` (Sonarr, Radarr, Prowlarr: key, port, URL base), `config/config.yaml` (Bazarr) and `settings.json` (Seerr / Jellyseerr / Overseerr; port 5055). Anything you set explicitly (`SONARR_URL`, `SONARR_API_KEY`, ...) wins, e.g. a LAN address when SafeHub is not on the apps' network. Note that these folders also hold the apps' other settings; SafeHub only reads the values above.

Jellyfin, Immich, Proxmox and Synology still need their keys set once (next section).

## Settings and credentials

The easiest way is the **Settings** page: values are saved encrypted in SafeHub's database and take effect immediately. Secret fields never show their saved value; leave them empty to keep it.

Every setting is also an environment variable, for those who prefer files: under `environment:` in `compose.yaml` or in an optional `.env` next to it ([`.env.example`](.env.example) lists them all). These win over the Settings page, which shows them as locked; apply changes with `docker compose up -d`. Anything without settings is simply hidden from the dashboard.

If the login secret changes, values saved on the Settings page can no longer be decrypted and must be entered again.

Addresses must start with `http://` or `https://` and must not contain a user name or password (`http://user:pass@host`); put credentials in their own fields. SafeHub refuses to start with such an address in `compose.yaml` / `.env`.

| What | Create it in | Setting | Notes |
|------|-------------|---------|-------|
| SafeHub account (username + password) | SafeHub, `/setup` page | Stored in the database | First visit. Sign-up closes afterwards. No email needed. |
| Login secret | Automatic (`data/auth-secret`) | `BETTER_AUTH_SECRET` (optional) | Only set it to choose your own. Changing it signs everyone out. |
| HTTPS address (optional) | Your reverse proxy, e.g. Caddy | `BETTER_AUTH_URL=https://safehub.example.lan` | Only when SafeHub is served over HTTPS: enables Secure cookies. Leave unset for plain `http://<IP>:3000`. |
| Extra addresses (optional) | The other addresses you open SafeHub at | `BETTER_AUTH_TRUSTED_ORIGINS=http://192.168.1.20:3000` | Only together with `BETTER_AUTH_URL`: comma-separated `http(s)://` origins you also use, e.g. the LAN IP next to the Caddy domain. |
| Proxmox API token | Settings → Proxmox → **Connect with password** (creates user `safehub@pve` and its token; the password is not stored), or Proxmox UI: Datacenter → Permissions → API Tokens | `PROXMOX_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET` | Connect needs an admin account without two-factor login. |
| Proxmox / Synology certificates | Automatic: pinned on first connection | Optional: `*_CA_CERT_PATH=./certs/<ca>.pem` to verify against a CA instead | A changed certificate shows an "Accept new certificate" button on the card |
| Proxmox backup age limit (optional) | | `PROXMOX_BACKUP_MAX_AGE_DAYS` (default 7) | Backups are read with the same token (PVEAuditor). Guests never backed up are not warned about. |
| Synology user + password | DSM: Control Panel → User. Dedicated user, in `administrators`, 2FA off, all apps denied | `SYNOLOGY_URL`, `SYNOLOGY_USERNAME`, `SYNOLOGY_PASSWORD` | DSM 6 and 7 |
| Sonarr / Radarr / Prowlarr / Bazarr API keys | Automatic (see above), or each app: Settings → General → API Key | `<APP>_URL`, `<APP>_API_KEY` | |
| Jellyfin API key | Jellyfin: Dashboard → API Keys → + | `JELLYFIN_URL`, `JELLYFIN_API_KEY` | |
| Seerr API key | Automatic (see above), or Seerr: Settings → General → API Key | `SEERR_URL`, `SEERR_API_KEY` | |
| Immich API key | Immich (as admin): Account Settings → API Keys | `IMMICH_URL`, `IMMICH_API_KEY` | |
| qBittorrent login | qBittorrent: Options → Web UI | `QBITTORRENT_URL`, `QBITTORRENT_USERNAME`, `QBITTORRENT_PASSWORD` | Behind Gluetun the Web UI is reached through Gluetun's container name (`http://gluetun:8080`). Login optional if "Bypass authentication for clients in whitelisted IP subnets" covers SafeHub. A rejected password stops login attempts until you change the credentials (or restart SafeHub), so qBittorrent never bans SafeHub's IP. With Gluetun configured too, the tile warns when qBittorrent listens on another port than the VPN forwards, and "Use VPN port" sets it. |
| Gluetun API key | Gluetun control server auth config (see below) | `GLUETUN_URL` (e.g. `http://gluetun:8000`), `GLUETUN_API_KEY` | Shows VPN status, public IP and forwarded port (older Gluetun versions: `/v1/openvpn/portforwarded`). A stopped VPN turns the tile red and raises an alert. |
| Docker containers (optional) | Uncomment `/var/run/docker.sock:/var/run/docker.sock:ro` under `volumes:` in `compose.yaml` | Nothing to set (`DOCKER_SOCKET` only for another path, e.g. rootless Docker) | Containers of the machine SafeHub runs on show under its Proxmox guest (or in a Docker card without Proxmox), with start, stop and restart. Matched by host name = guest name, or by Docker networks (VMs need the QEMU guest agent). Access to the socket equals root on that machine. SafeHub joins the socket's group, never group 0: if the socket belongs to `root:root` (some NAS systems), the log and Check setup show a warning and Docker stays hidden until you give it a group on the host, e.g. `sudo chgrp docker /var/run/docker.sock` (Synology: `sudo synogroup --add docker` first). |
| Phone notifications (optional) | ntfy app: subscribe to a topic of your choice | `NTFY_TOPIC`, optional `NTFY_URL` (default `https://ntfy.sh`), `NTFY_TOKEN`, `NTFY_CRITICAL_ONLY` | Use a long random topic: on ntfy.sh anyone who knows it can read the messages. Or run your own server (below). Settings has a test button. |

**Gluetun API key.** Since 3.40, Gluetun's control server only answers roles from its auth config. Create `config.toml` in a folder mounted into Gluetun, point `HTTP_CONTROL_SERVER_AUTH_CONFIG_FILEPATH` at it, and set the same key as `GLUETUN_API_KEY`:

```toml
[[roles]]
name = "safehub"
routes = ["GET /v1/vpn/status", "GET /v1/publicip/ip", "GET /v1/portforward"]
auth = "apikey"
apikey = "<long random key>"
```

**Keys in `compose.yaml` or `.env`?** Both work. If `compose.yaml` holds keys, treat it like a secret file: `chmod 600 compose.yaml`, and never commit or share it. Write a literal `$` in a value as `$$`, because Compose reads `$` as a variable. A separate `.env` keeps keys out of a file you may want to share or put in git.

## Deploy (Docker)

SafeHub runs on any always-on Linux machine with Docker that can reach your services, for example a NAS or a VM/LXC on a Proxmox host. It listens on port 3000; change the left side of `ports:` in `compose.yaml` to use another host port.

The container starts as root only to make `./data` writable, then runs SafeHub as `PUID`/`PGID` (default `1000`, set in `compose.yaml`).

**Paths:** keep every path in settings relative (`DATABASE_PATH=./data/safehub.db`, `PROXMOX_CA_CERT_PATH=./certs/pve-root-ca.pem` if you use one). The app runs in `/app` inside the container, where `./data` and `./certs` are mounted from the project folder, so the same values work in Docker and in development.

**Update:** `docker compose pull && docker compose up -d`. Database migrations run automatically on start. The header shows a badge when a newer version exists.

**Build from source instead** (e.g. to test changes): replace the `image:` line in `compose.yaml` with
```yaml
    build:
      context: https://github.com/lamonfly/SafeHub.git#main
```
and update with `docker compose up -d --build`.

**Forgot the password:** there is no reset email. Delete the account and `/setup` opens again (nothing else is lost):
```bash
sqlite3 data/safehub.db "DELETE FROM user;"
```

**Backup:** the `data` folder holds the database (account, settings, pinned certificates, history and alerts) and the login secret. History takes a few tens of MB. Stop the container (`docker compose stop`) before copying it.

### Own ntfy server (optional)

Alerts can go to your own [ntfy](https://docs.ntfy.sh) server instead of ntfy.sh, so nothing leaves your network. This is for the Android app: it keeps its own connection to the server. (On iPhone, instant notifications from a self-hosted server need a relay through ntfy.sh.)

1. In `compose.yaml`, uncomment the `ntfy` service and set `NTFY_BASE_URL` to this machine's address and port, e.g. `http://192.168.1.20:8080`. Start it: `docker compose up -d`.
2. Create a user for SafeHub that may only send, and one for your phone that may only read (each asks for a password):
   ```bash
   docker compose exec ntfy ntfy user add safehub
   docker compose exec ntfy ntfy access safehub safehub write-only
   docker compose exec ntfy ntfy token add safehub     # prints tk_...
   docker compose exec ntfy ntfy user add phone
   docker compose exec ntfy ntfy access phone safehub read-only
   ```
   With login required for everything (`deny-all`), the topic name `safehub` does not need to be secret.
3. In SafeHub (Settings → Notifications or `compose.yaml`): topic `safehub`, server `http://ntfy` (the container name; both run in the same Compose project), access token the `tk_...` value. Press **Send test**.
4. On the phone, in the ntfy app: Settings → Manage users → add `http://192.168.1.20:8080` with the `phone` user, then + → topic `safehub`, "Use another server", same address. Allow the app to ignore battery optimisation so it stays connected.

Away from home the phone reaches the server only through your VPN (Tailscale/WireGuard). Messages are kept for 24 hours and arrive when the phone connects again. Check setup (Settings) shows whether SafeHub reaches the server. The `ntfy` folder holds its users and tokens; keep it private.

### Add to an existing Docker Compose stack

If you already run a Compose stack (for example Sonarr, Radarr, Prowlarr, Jellyseerr), add SafeHub as one more service. It then shares the stack's network and reaches the other containers by name, with no extra published ports. Its files stay in a `safehub/` folder next to your `compose.yaml`; Docker creates it on the first start.

Add to your `compose.yaml` under `services:` (the full list of settings is in the repo's [`compose.yaml`](compose.yaml)):

```yaml
  safehub:
    image: ghcr.io/lamonfly/safehub:latest
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
      # Optional: containers with start/stop/restart (equals root on this machine)
      # - /var/run/docker.sock:/var/run/docker.sock:ro
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
QBITTORRENT_URL=http://gluetun:8080   # qBittorrent shares Gluetun's network
GLUETUN_URL=http://gluetun:8000
```

Services on other machines (Proxmox, Synology, anything outside this stack) use their LAN address as usual.

Start, update and logs:

```bash
docker compose pull safehub && docker compose up -d safehub     # first start and every update
docker compose logs -f safehub
```

**SafeHub in its own folder** (Quick start) can still use container names: uncomment the `networks:` lines at the bottom of its `compose.yaml` and set the stack's network name (`docker network ls`, usually `<folder>_default`). Otherwise use the LAN address and published port of each service.

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

Checks (GitHub runs all of them on every push; an image is only published when they pass):

```bash
npm run lint
npm run typecheck             # generates Next route types, then tsc
npm test                     # unit and integration tests (Vitest)
npm run build && npm run test:smoke   # starts the production build and opens every page
```

See `CLAUDE.md` for architecture and conventions. After changing the database schema: `npm run db:generate`, then `npm run db:migrate` (or restart the dev server).

## License

[MIT](LICENSE). Not affiliated with or endorsed by Proxmox, Synology, or the projects whose services SafeHub connects to; their names are trademarks of their respective owners.
