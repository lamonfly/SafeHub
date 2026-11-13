import "server-only";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "@/db";

// Applies pending migrations from ./drizzle. Safe to run on every start.
export function runMigrations() {
  migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
}
