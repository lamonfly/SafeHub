-- The Caddy integration was removed: drop its saved setting.
DELETE FROM `setting` WHERE `key` = 'CADDY_ADMIN_URL';
