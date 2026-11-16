CREATE TABLE `notification_pause` (
	`id` integer PRIMARY KEY NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `alert` ADD `muted_until` integer;