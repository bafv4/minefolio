ALTER TABLE `social_links` RENAME COLUMN "url" TO "identifier";--> statement-breakpoint
ALTER TABLE `social_links` DROP COLUMN `username`;