import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Machines that can be woken with Wake on LAN.
export const wolDevice = sqliteTable("wol_device", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  mac: text("mac").notNull().unique(), // normalized "aa:bb:cc:dd:ee:ff"
  broadcast: text("broadcast").notNull().default("255.255.255.255"),
  port: integer("port").notNull().default(9),
  // Optional online check: TCP connect to host:checkPort.
  host: text("host"),
  checkPort: integer("check_port"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type WolDevice = typeof wolDevice.$inferSelect;
