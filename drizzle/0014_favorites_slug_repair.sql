-- favorites.favorite_mcid → favorite_slug のリペアマイグレーション
-- 経緯: この変更は過去に `db:push` で本番へ直接反映され、マイグレーションチェーンには
--   含まれていなかった（スナップショットのみ手動で整合済み）。
--   マイグレーションから新規構築した環境がアプリコード（favorite_slug）と一致するように修復する。
-- 既に favorite_slug 化済みのDBでは実行しないこと（db:push 運用の本番はジャーナル未管理のため対象外）。
ALTER TABLE `favorites` RENAME COLUMN `favorite_mcid` TO `favorite_slug`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_favorites_user_mcid`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_favorites_user_slug` ON `favorites` (`user_id`,`favorite_slug`);
