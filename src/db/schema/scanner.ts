import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

// One row per discovery scan.
export const scanRun = sqliteTable("scan_run", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cidr: text("cidr").notNull(),
  hostsFound: integer("hosts_found"),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
});

// Hosts seen on the network. id is the MAC when known (stable across DHCP
// changes), otherwise "ip:<address>".
export const networkHost = sqliteTable(
  "network_host",
  {
    id: text("id").primaryKey(),
    ip: text("ip").notNull(),
    mac: text("mac"),
    vendor: text("vendor"),
    hostname: text("hostname"),
    openPorts: text("open_ports", { mode: "json" }).$type<number[]>(),
    portsScannedAt: timestamp("ports_scanned_at"),
    firstSeenAt: timestamp("first_seen_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastSeenAt: timestamp("last_seen_at").notNull(),
  },
  (table) => [index("network_host_ip_idx").on(table.ip)],
);

export type ScanRun = typeof scanRun.$inferSelect;
export type NetworkHost = typeof networkHost.$inferSelect;
