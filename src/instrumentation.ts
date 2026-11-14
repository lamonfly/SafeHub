// Runs once when the server starts. Validates env and migrates the database,
// so bad configuration stops the server at boot instead of failing on a request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/env");
    const { runMigrations } = await import("@/db/migrate");
    runMigrations();

    // Report auto-setup results (never the keys) so `docker compose logs`
    // shows which apps were picked up from ./appdata.
    const { discovered } = await import("@/lib/integrations/discovery");
    const found = Object.entries(discovered).map(([app, { url }]) => `${app} (${url})`);
    if (found.length > 0) console.log(`Auto-setup from ./appdata: ${found.join(", ")}`);
  }
}
