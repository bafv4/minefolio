-- Add verification_status column to player_rankings
ALTER TABLE `player_rankings` ADD `verification_status` text DEFAULT 'verified';
