import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every test file runs in its own process with a fresh database and a fixed
// login secret. Nothing from a developer's .env.local leaks in: only the
// variables a test sets itself (before importing app modules) apply.
for (const key of Object.keys(process.env)) {
  if (/^(PROXMOX|SYNOLOGY|SONARR|RADARR|PROWLARR|BAZARR|JELLYFIN|SEERR|IMMICH|QBITTORRENT|GLUETUN|NTFY|DOCKER|BETTER_AUTH)_/.test(key)) {
    delete process.env[key];
  }
}
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "safehub-test-")), "safehub.db");
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123";
process.env.DISABLE_UPDATE_CHECK = "true";
// /var/run/docker.sock exists on CI runners and many dev machines: never
// talk to the real Docker from tests (docker.test.ts sets its own fake).
process.env.DOCKER_SOCKET = join(tmpdir(), "safehub-no-docker.sock");
