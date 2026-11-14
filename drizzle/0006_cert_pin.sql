CREATE TABLE `cert_pin` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`pinned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
