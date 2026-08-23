// users.slug の変更履歴（旧slug→現ユーザー）を管理するヘルパー。
//
// MCID登録（set_mcid）・MCID削除（remove_mcid）で users.slug が変わるたびに旧 slug を
// 記録しておき、/player/:slug 等が 404 になったとき slug_history から現在の slug を
// 引いて 302 リダイレクトする（app/lib/player-slug-fallback.server.ts から呼ばれる）。
//
// Mojang API 起点のフォールバックと違い DB 内で完結するため確実に解決できる。テーブル定義・
// 整合性ポリシー（小文字保存・upsert・cascade）は app/lib/schema.ts の slugHistory コメント参照。

import { and, eq } from "drizzle-orm";
import type { Database } from "./db";
import { slugHistory, users } from "./schema";
import { publiclyReferencableCondition } from "./users-filter";

/** drizzle のトランザクション内外どちらでも使える最小インターフェース（preset-utils.ts と同じ方式） */
type DatabaseOrTransaction = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * MCID変更（set_mcid）・MCID削除（remove_mcid）で slug が変わる直前に呼ぶ。
 * 旧 slug を履歴として記録し（既に同じ旧slugの履歴があれば元所有者を上書き）、
 * 新 slug が過去に別ユーザーの旧slugとして記録されていればその履歴を削除する
 * （新slugには現役の持ち主ができたため、古い対応付けは不要になる）。
 *
 * 大文字小文字だけの変更（例: "Foo" → "foo"）は「別のslugになった」とみなさず何もしない
 * （小文字化して比較するため、users 側では別値でも履歴上は同一slugになってしまうのを防ぐ）。
 */
export async function recordSlugChange(
  tx: DatabaseOrTransaction,
  { userId, oldSlug, newSlug }: { userId: string; oldSlug: string; newSlug: string },
): Promise<void> {
  const oldSlugLower = oldSlug.toLowerCase();
  const newSlugLower = newSlug.toLowerCase();

  if (oldSlugLower === newSlugLower) {
    return;
  }

  const now = new Date();
  await tx
    .insert(slugHistory)
    .values({ slug: oldSlugLower, userId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: slugHistory.slug,
      set: { userId, updatedAt: now },
    });

  await tx.delete(slugHistory).where(eq(slugHistory.slug, newSlugLower));
}

/**
 * 新規ユーザーが slug を初めて取得する（オンボーディング）際に呼ぶ。
 * そのslugが過去に別ユーザーの旧slugとして記録されていれば削除する（掃除）。
 * insert が UNIQUE 制約違反で失敗する経路では呼ばないこと（成功後のみ）。
 */
export async function claimSlug(tx: DatabaseOrTransaction, slug: string): Promise<void> {
  await tx.delete(slugHistory).where(eq(slugHistory.slug, slug.toLowerCase()));
}

/**
 * 404になった slug を旧slugとみなして slug_history から引き、現在の slug を返す。
 * 参照先ユーザーが公開/限定公開（publiclyReferencableCondition）でなければ救済しない。
 * ヒットしない・非公開・（理論上起きないはずの）自己参照ループの場合は null。
 */
export async function resolveSlugFromHistory(
  db: Database,
  requestedSlug: string,
): Promise<string | null> {
  const requestedSlugLower = requestedSlug.toLowerCase();

  const [match] = await db
    .select({ slug: users.slug })
    .from(slugHistory)
    .innerJoin(users, eq(slugHistory.userId, users.id))
    .where(and(eq(slugHistory.slug, requestedSlugLower), publiclyReferencableCondition))
    .limit(1);

  if (!match) {
    return null;
  }

  return match.slug.toLowerCase() === requestedSlugLower ? null : match.slug;
}
