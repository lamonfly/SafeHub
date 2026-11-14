import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Certificates trusted on first use, one per service address
// ("proxmox@192.168.1.10:8006"). See lib/integrations/tls.ts.
export const certPin = sqliteTable("cert_pin", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(), // SHA-256, "AB:CD:..."
  pinnedAt: integer("pinned_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});
