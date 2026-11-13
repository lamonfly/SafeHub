CREATE TABLE `network_host` (
	`id` text PRIMARY KEY NOT NULL,
	`ip` text NOT NULL,
	`mac` text,
	`vendor` text,
	`hostname` text,
	`open_ports` text,
	`ports_scanned_at` integer,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `network_host_ip_idx` ON `network_host` (`ip`);--> statement-breakpoint
CREATE TABLE `scan_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cidr` text NOT NULL,
	`hosts_found` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
