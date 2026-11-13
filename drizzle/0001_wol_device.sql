CREATE TABLE `wol_device` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mac` text NOT NULL,
	`broadcast` text DEFAULT '255.255.255.255' NOT NULL,
	`port` integer DEFAULT 9 NOT NULL,
	`host` text,
	`check_port` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wol_device_mac_unique` ON `wol_device` (`mac`);