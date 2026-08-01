// プロフィール絵文字リアクションのサーバー側ロジック（docs/profile-reactions.md）。
// 常時有効の標準機能（かつてはフィーチャーフラグ付きだったが撤去済み）。
//
// 方針（likes.server.ts の相似形。差分は docs/profile-reactions.md 参照）:
// - db を第一引数に取り、Request / セッションはここでは扱わない（likes.server.ts と同じ）
// - 自分のプロフィールにも押せる（self 拒否なし）。likes と異なり著者=閲覧者を拒否しない
// - カウントは非正規化列を持たず、この表の COUNT(*) を都度算出する（likes と同じ方針）

import { and, eq, sql } from "drizzle-orm";
import { profileReactions, users } from "./schema";
import {
  isProfileReactionEmoji,
  PROFILE_REACTION_EMOJIS,
  type ProfileReactionCount,
  type ProfileReactionEmoji,
} from "./profile-reactions";
import type { Database } from "./db";

export type ProfileReactionResult =
  | { ok: true; reacted: boolean; count: number }
  /** not_found: 対象プロフィール不存在、または private かつ reactor が本人以外。
   *  呼び出し側は列挙オラクルを避けるため区別せず404にする（likes.server.ts と同方針） */
  | { ok: false; reason: "not_found" };

// ============================================
// 読み取り
// ============================================

/**
 * プロフィール1件の絵文字別カウント。0件の絵文字は含めず、
 * PROFILE_REACTION_EMOJIS の並び順に整列して返す（表示順の安定化・許可リスト外の
 * 遺物行 — 将来絵文字セットを変更した場合の残存行 — は走査対象外になるため自然に除外される）。
 */
export async function getProfileReactionCounts(
  db: Database,
  profileUserId: string,
): Promise<ProfileReactionCount[]> {
  const rows = await db
    .select({ emoji: profileReactions.emoji, count: sql<number>`count(*)` })
    .from(profileReactions)
    .where(eq(profileReactions.profileUserId, profileUserId))
    .groupBy(profileReactions.emoji);

  const countByEmoji = new Map<string, number>(rows.map((r) => [r.emoji, Number(r.count)]));

  return PROFILE_REACTION_EMOJIS.filter((emoji) => (countByEmoji.get(emoji) ?? 0) > 0).map(
    (emoji) => ({ emoji, count: countByEmoji.get(emoji)! }),
  );
}

/**
 * 閲覧者がこのプロフィールに押している絵文字一覧（ピルのハイライト判定用）。
 * viewerUserId が null（未ログイン）なら SQL を発行せず空を返す（getViewerLikedIds と同方針）。
 */
export async function getViewerProfileReactions(
  db: Database,
  profileUserId: string,
  viewerUserId: string | null,
): Promise<ProfileReactionEmoji[]> {
  if (!viewerUserId) return [];

  const rows = await db
    .select({ emoji: profileReactions.emoji })
    .from(profileReactions)
    .where(
      and(
        eq(profileReactions.profileUserId, profileUserId),
        eq(profileReactions.reactorUserId, viewerUserId),
      ),
    );

  return rows.map((r) => r.emoji).filter(isProfileReactionEmoji);
}

/** 対象プロフィール・絵文字1件のカウント（書き込み後の応答用）。 */
async function getReactionCount(
  db: Database,
  profileUserId: string,
  emoji: ProfileReactionEmoji,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(profileReactions)
    .where(
      and(eq(profileReactions.profileUserId, profileUserId), eq(profileReactions.emoji, emoji)),
    );
  return Number(row?.count ?? 0);
}

// ============================================
// 書き込み
// ============================================

// 可視性ルール（likes と異なる点）:
//   追加（reacted: true）時のみ「対象プロフィールが存在し、private なら reactor が本人であること」
//   を検査する。private かつ本人以外は not_found（不存在と区別しない）。
//   本人は自分のプロフィールが private でも押せる（self 拒否なし）。
//   解除（reacted: false）は無検査delete（非公開化後も自分の分は外せる。likes と同方針）。

/**
 * プロフィールへの絵文字リアクションを追加・解除する（冪等・API ルート用のディスパッチャ）。
 * 戻りの count は書き込み後にこの表から直接数え直した権威値。
 */
export async function setProfileReaction(
  db: Database,
  reactorUserId: string,
  profileUserId: string,
  emoji: ProfileReactionEmoji,
  reacted: boolean,
): Promise<ProfileReactionResult> {
  if (reacted) {
    const [target] = await db
      .select({ profileVisibility: users.profileVisibility })
      .from(users)
      .where(eq(users.id, profileUserId));

    if (!target) return { ok: false, reason: "not_found" };
    if (target.profileVisibility === "private" && reactorUserId !== profileUserId) {
      return { ok: false, reason: "not_found" };
    }

    // 連打による重複挿入を1文で吸収する（likeGuide と同じ TOCTOU 対策）。
    // ユニーク索引（profileUserId, emoji, reactorUserId）により1人1対象1絵文字1件が保証される。
    await db
      .insert(profileReactions)
      .values({ profileUserId, reactorUserId, emoji })
      .onConflictDoNothing({
        target: [
          profileReactions.profileUserId,
          profileReactions.emoji,
          profileReactions.reactorUserId,
        ],
      });
  } else {
    await db
      .delete(profileReactions)
      .where(
        and(
          eq(profileReactions.profileUserId, profileUserId),
          eq(profileReactions.emoji, emoji),
          eq(profileReactions.reactorUserId, reactorUserId),
        ),
      );
  }

  return { ok: true, reacted, count: await getReactionCount(db, profileUserId, emoji) };
}
