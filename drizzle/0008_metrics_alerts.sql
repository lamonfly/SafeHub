CREATE TABLE `alert` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`unit` text DEFAULT '%' NOT NULL,
	`peak` real,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `alert_key_idx` ON `alert` (`key`);--> statement-breakpoint
CREATE INDEX `alert_started_idx` ON `alert` (`started_at`);--> statement-breakpoint
CREATE TABLE `metric_hourly` (
	`series` text NOT NULL,
	`ts` integer NOT NULL,
	`avg` real NOT NULL,
	`max` real NOT NULL,
	PRIMARY KEY(`series`, `ts`)
);
--> statement-breakpoint
CREATE INDEX `metric_hourly_ts_idx` ON `metric_hourly` (`ts`);--> statement-breakpoint
CREATE TABLE `metric_sample` (
	`series` text NOT NULL,
	`ts` integer NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`series`, `ts`)
);
--> statement-breakpoint
CREATE INDEX `metric_sample_ts_idx` ON `metric_sample` (`ts`);