# SafeHub

Self-hosted dashboard for a home lab. One page to see and control your servers and services, wake machines and scan your network. Runs as a single Docker container on your LAN.

## Features

- **Proxmox:** node CPU, RAM and uptime; VMs and LXCs with start, shut down, reboot, force stop and resume (destructive actions ask first).
- **Synology:** CPU, RAM, volume usage, disk health and temperatures. Works with DSM 6 and 7.
- **Services:** status, version and key numbers for Sonarr, Radarr, Prowlarr, Bazarr, Jellyfin, Seerr (Jellyseerr/Overseerr), Immich and Caddy. Health warnings show on each tile.
- **Wake on LAN:** saved devices with online/offline status and a Wake button.
- **Network scanner:** finds hosts (IP, MAC, vendor, hostname), scans ports with names for common home lab services, flags new devices, and adds any host to Wake on LAN in one click.
- **Fails soft:** an unconfigured or unreachable service shows its own error; the rest of the dashboard keeps working.
- **Single admin login**, SQLite storage, no external services or telemetry.

Built with Next.js, better-auth, Drizzle (SQLite) and Tailwind CSS.

## Security

> [!WARNING]
> SafeHub is an admin tool. Whoever logs in can shut down VMs, wake machines and scan your network, and the server holds API keys and passwords for all connected services. Treat access to it like root access to your home lab.

- **Never expose it to the internet.** No port forwarding. For remote access use a VPN such as Tailscale or WireGuard.
- **Pick a real password.** SafeHub lets the password be anything, including empty, for convenience on a trusted LAN. Anyone who can reach the login page and guesses the username gets full control. Failed logins are limited (5 per 15 minutes per username), which slows guessing but does not replace a password.
- **Give every API key the least rights it needs:** a Proxmox token with only `PVEAuditor` (plus `PVEVMUser` if you want the buttons), a dedicated Synology user, never your personal accounts.
- **Keep `.env` private** (`chmod 600 .env`). It holds every key. It is gitignored; never commit it or paste it into issues.
- **Caddy's admin API has no authentication.** Only connect it if SafeHub runs on the same host and the API stays on `127.0.0.1`.
- **Prefer certificate checks.** Use the `*_CA_CERT_PATH` options; `*_ALLOW_SELF_SIGNED=true` keeps traffic encrypted but cannot detect an impostor on your LAN.

Found a security issue? Please report it privately through GitHub's "Report a vulnerability" (Security tab) instead of opening a public issue.

## Credentials: what goes where

Everything secret lives in **one file, `.env`**, next to `compose.yaml` on the host that runs SafeHub (for local development: `.env.local` in the project folder). Copy `.env.example` to start; it lists every variable with setup notes. Only two things are entered in the browser instead.

| What | Create it in | Put it in | When |
|------|-------------|-----------|------|
| `BETTER_AUTH_SECRET` | Generate: `openssl rand -base64 32` | `.env` | Before the first start. Changing it later signs everyone out. |
| `BETTER_AUTH_URL` | The address you open SafeHub at, e.g. `http://192.168.1.20:3000` | `.env` | Before the first start. A wrong value makes login fail with "Invalid origin". |
| `BETTER_AUTH_TRUSTED_ORIGINS` (optional) | Other addresses you open SafeHub at, comma-separated | `.env` | Only if you use more than one address (e.g. LAN IP and a Caddy domain). |
| SafeHub admin account (username + password) | SafeHub, `/setup` page in the browser | Database | First visit after the first start. Sign-up closes afterwards. No email needed. |
| Proxmox API token | Proxmox UI: Datacenter → Permissions → API Tokens | `.env`: `PROXMOX_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET` | Any time. The secret is shown only once. |
| Proxmox CA certificate | Copy `/etc/pve/pve-root-ca.pem` from the Proxmox host | `./certs/pve-root-ca.pem`, and `.env`: `PROXMOX_CA_CERT_PATH=/app/certs/pve-root-ca.pem` | With the token |
| Synology user + password | DSM: Control Panel → User. Dedicated user, in `administrators`, 2FA off, all apps denied | `.env`: `SYNOLOGY_URL`, `SYNOLOGY_USERNAME`, `SYNOLOGY_PASSWORD` | Any time |
| Sonarr / Radarr / Prowlarr / Bazarr API keys | Each app: Settings → General → API Key | `.env`: `<APP>_URL`, `<APP>_API_KEY` | Any time |
| Jellyfin API key | Jellyfin: Dashboard → API Keys → + | `.env`: `JELLYFIN_URL`, `JELLYFIN_API_KEY` | Any time |
| Seerr API key | Seerr: Settings → General → API Key | `.env`: `SEERR_URL`, `SEERR_API_KEY` | Any time |
| Immich API key | Immich (as admin): Account Settings → API Keys | `.env`: `IMMICH_URL`, `IMMICH_API_KEY` | Any time |
| Caddy admin address | Caddyfile global `admin` option | `.env`: `CADDY_ADMIN_URL` | Any time. Read the warning in `.env.example` first. |
| Wake on LAN devices | SafeHub, `/settings/wol` (or "Add to WoL" on `/scanner`) | Database | Any time, no restart |

After editing `.env`, apply it with `docker compose up -d` (a plain `restart` does not reload `.env`). Unset services just show as "not configured".

Protect the file: `chmod 600 .env`. Never commit it (`.gitignore` already excludes it).

## Deploy (Docker)

SafeHub must run on an always-on Linux machine on the same LAN as the machines it wakes and scans, for example a NAS or a VM/LXC on a Proxmox host. It cannot wake the machine it runs on. It uses host networking (needed for Wake on LAN broadcasts and MAC addresses), so it listens directly on the host's port 3000 (change with `PORT` in `.env`).

1. Copy the project to the host, e.g. `/volume1/docker/safehub` (Synology) or `/opt/safehub` (Linux).
2. Create the config and folders:
   ```bash
   cp .env.example .env      # then fill it in (see table above)
   chmod 600 .env
   mkdir -p data certs
   ```
3. Make `data` writable for the container user. Find your ids with `id`, then either put them in `.env` (`PUID=1026`, `PGID=100` is typical on Synology) or keep the default `1000:1000`:
   ```bash
   sudo chown -R 1000:1000 data   # or your PUID:PGID
   ```
4. Build and start:
   ```bash
   docker compose up -d --build
   docker compose logs -f safehub   # wait for "Ready"
   ```
5. Open `BETTER_AUTH_URL` in the browser. You land on `/setup`: create the admin account.

**Update:** pull or copy the new code, then `docker compose up -d --build`. Database migrations run automatically on start.

**Forgot the password:** there is no reset email. Delete the account and `/setup` opens again (WoL devices and scan history are kept):
```bash
sqlite3 data/safehub.db "DELETE FROM user;"
```

**Backup:** `data/safehub.db` holds accounts, WoL devices and scan history. Stop the container (`docker compose stop`) before copying it, or copy `safehub.db`, `safehub.db-wal` and `safehub.db-shm` together.

### Synology NAS

- Needs Container Manager (DSM 7.2+, mostly x86 "plus" models).
- Easiest via SSH (Control Panel → Terminal & SNMP → enable SSH), then run the steps above with `sudo docker compose ...` in `/volume1/docker/safehub`.
- Or in Container Manager → Project → Create, with the project folder as path and the existing `compose.yaml`.
- Port 5000/5001 are DSM's; keep SafeHub on 3000 or another free port.

### Proxmox

- Run Docker in a VM, or in an LXC with `nesting=1,keyctl=1` (Options → Features). The guest's network must be bridged to the LAN (`vmbr0`) so broadcasts reach other machines: `ip -4 addr` inside the guest should show a LAN address.
- Do not run it on the Proxmox host itself.
- Check that the port is free on the guest: `ss -ltnp | grep :3000`.

## Development

```bash
cp .env.example .env.local   # fill in BETTER_AUTH_SECRET at least
npm install
npm run dev                  # http://localhost:3000
```

See `CLAUDE.md` for architecture and conventions. After changing the database schema: `npm run db:generate`, then `npm run db:migrate` (or restart the dev server).

## License

[MIT](LICENSE). Not affiliated with or endorsed by Proxmox, Synology, or the projects whose services SafeHub connects to; their names are trademarks of their respective owners.
