// Runs once when the server starts. Validates env and migrates the database,
// so bad configuration stops the server at boot instead of failing on a request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/env");
    const { runMigrations } = await import("@/db/migrate");
    runMigrations();
  }
}
