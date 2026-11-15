// Smoke test of the production build: starts .next/standalone/server.js on a
// fresh database, logs in, opens every page and fails on a bad status or any
// server error in the log. Catches render-time crashes that typecheck, lint
// and unit tests cannot see.
//
// Run after `npm run build`:  npm run test:smoke

import { spawn } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const standalone = join(root, ".next", "standalone");
const port = 3999;
const base = `http://127.0.0.1:${port}`;

const env = {
  DATABASE_PATH: join(mkdtempSync(join(tmpdir(), "safehub-smoke-")), "safehub.db"),
  BETTER_AUTH_SECRET: "smoke-test-secret-smoke-test-secret-01",
  DISABLE_UPDATE_CHECK: "true",
  // Never the machine's real Docker (CI runners have one).
  DOCKER_SOCKET: "/nonexistent/docker.sock",
  // An unreachable Synology: its seeded volume alert must stay open (alerts
  // of a source removed from the settings close on the first check).
  SYNOLOGY_URL: "http://127.0.0.1:9",
  SYNOLOGY_USERNAME: "smoke",
  SYNOLOGY_PASSWORD: "smoke",
};
Object.assign(process.env, env);
process.chdir(root);

// 1. Database with an admin, a session, an open and a resolved alert, and
//    some history, so the alert list and charts actually render.
const { runMigrations } = await import("@/db/migrate");
runMigrations();
const { db } = await import("@/db");
const { alert, metricSample } = await import("@/db/schema");
const { auth, createFirstAdmin, placeholderEmail, toStoredPassword } = await import("@/lib/auth");

await createFirstAdmin(() =>
  auth.api.signUpEmail({ body: { name: "smoke", username: "smoke", email: placeholderEmail("smoke"), password: toStoredPassword("") } }),
);
const login = await auth.api.signInUsername({ body: { username: "smoke", password: toStoredPassword("") }, returnHeaders: true });
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

const now = Date.now();
db.insert(alert)
  .values([
    { key: "synology:volume:/volume1", severity: "warning", title: "Synology /volume1: almost full", message: "87% used.", unit: "%", peak: 87, startedAt: new Date(now - 20 * 60_000) },
    { key: "service:sonarr:up", severity: "critical", title: "Sonarr: unreachable", message: "No answer for 3+ minutes.", unit: "", startedAt: new Date(now - 26 * 3_600_000), endedAt: new Date(now - 25 * 3_600_000) },
  ])
  .run();
db.insert(metricSample)
  .values(Array.from({ length: 120 }, (_, index) => ({ series: "node:pve:cpu", ts: now - (now % 60_000) - index * 60_000, value: 20 + (index % 30) })))
  .run();

// 2. Start the standalone server the way the Docker image does.
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
cpSync(join(root, "drizzle"), join(standalone, "drizzle"), { recursive: true });

let log = "";
const server = spawn(process.execPath, ["server.js"], {
  cwd: standalone,
  env: { ...process.env, ...env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1" },
});
server.stdout.on("data", (chunk) => (log += chunk));
server.stderr.on("data", (chunk) => (log += chunk));

const failures: string[] = [];
try {
  for (let waited = 0; ; waited += 500) {
    if (await fetch(`${base}/api/health`).then((response) => response.ok, () => false)) break;
    if (waited > 30_000) throw new Error(`Server did not start:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // 3. Every page, logged in or not, with what it must contain.
  const checks: { path: string; status: number; loggedIn?: boolean; contains?: string; location?: string }[] = [
    { path: "/api/health", status: 200 },
    { path: "/login", status: 200, contains: "Sign in to SafeHub" },
    { path: "/", status: 307, location: "/login" },
    { path: "/", status: 200, loggedIn: true, contains: "problem" },
    { path: "/settings", status: 200, loggedIn: true, contains: "Settings" },
    { path: "/alerts", status: 200, loggedIn: true, contains: "Sonarr: unreachable" },
    { path: "/diagnostics", status: 200, loggedIn: true, contains: "Check setup" },
    { path: "/history/synology", status: 200, loggedIn: true },
    { path: "/history/node/pve", status: 200, loggedIn: true, contains: "Proxmox node pve" },
    { path: "/history/guest/pve/101", status: 200, loggedIn: true },
    { path: "/history/bogus", status: 404, loggedIn: true },
    { path: "/manifest.webmanifest", status: 200, contains: "SafeHub" },
    { path: "/pwa-icon/192", status: 200 },
    { path: "/icon", status: 200 },
  ];
  for (const check of checks) {
    const response = await fetch(`${base}${check.path}`, {
      redirect: "manual",
      headers: check.loggedIn ? { cookie } : {},
    });
    const label = `${check.loggedIn ? "logged in" : "anonymous"} ${check.path}`;
    if (response.status !== check.status) failures.push(`${label}: status ${response.status}, expected ${check.status}`);
    if (check.location && !response.headers.get("location")?.endsWith(check.location)) {
      failures.push(`${label}: redirected to ${response.headers.get("location")}, expected ${check.location}`);
    }
    if (check.contains && !(await response.text()).includes(check.contains)) {
      failures.push(`${label}: page does not contain "${check.contains}"`);
    }
    console.log(`${failures.length && failures.at(-1)!.startsWith(label) ? "FAIL" : "ok  "} ${label}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  const serverErrors = log.split("\n").filter((line) => line.includes("⨯") || /\bError:/.test(line));
  if (serverErrors.length > 0) failures.push(`server log has errors:\n${serverErrors.join("\n")}`);
} finally {
  server.kill();
}

if (failures.length > 0) {
  console.error(`\nSmoke test failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nSmoke test passed.");
process.exit(0);
