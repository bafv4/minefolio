// アカウント削除・ガイド削除時の派生データ（Vercel Blob 実体・翻訳キャッシュ）の掃除。
//
// 呼び出し側（action）は合成ドメイン操作の `deleteUserAccount()` / `deleteGuide()` を
// 1回呼ぶだけでよい。内部で以下の2段階を行う:
//
// 1. DB 系（deleteTranslationsFor* + 本体行の削除 + favorites孤児行削除等）は単一の
//    db.transaction() 内で原子化する。どこかが失敗すれば全体がロールバックされる
//    （「他ユーザーが押した favorites 行だけ消えた」のような部分状態を防ぐ）。
// 2. トランザクション成功後、Blob 系（cleanup*Blobs）を runAfterResponse() 経由で
//    レスポンス後に実行する。これは絶対に throw しない best-effort で、失敗しても
//    アカウント削除・ガイド削除の本体（DB 行の削除）は完了済みのため影響しない
//    （app/lib/targeted-refresh.server.ts の「絶対ブロック・失敗させない」設計を踏襲）。
// 消し残した Blob は scripts/audit-orphan-blobs.ts / delete-orphan-blobs.ts が
// 後から拾える（docs/guides.md「参照されなくなった Blob の回収」参照）。
//
// deleteTranslationsForGuide / deleteTranslationsForUser / cleanupUserBlobs /
// cleanupGuideBlobs は上記2関数の内部実装（個別のテスト対象として export は維持）。

import { eq, and, or, like, inArray } from "drizzle-orm";
import { del } from "@vercel/blob";
import type { Database } from "./db";
import { createDb } from "./db";
import { contentTranslations, guides, users, favorites, authSessions, authAccounts, authUsers } from "./schema";
import { isVercelBlobUrl, collectBlobPathnames } from "./blob-url";
import { listAllBlobs, delBlobsInBatches } from "./blob-storage.server";
import { runAfterResponse } from "./targeted-refresh.server";

/** drizzle のトランザクション内外どちらでも使える最小インターフェース（app/lib/favorites.ts と同じ方式） */
type DatabaseOrTransaction = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** guides.id に紐づく翻訳キャッシュ行を削除する（ガイド削除時に呼ぶ。deleteGuide() の内部実装） */
export async function deleteTranslationsForGuide(db: DatabaseOrTransaction, guideId: string): Promise<void> {
  await db
    .delete(contentTranslations)
    .where(and(eq(contentTranslations.targetType, "guide"), eq(contentTranslations.targetId, guideId)));
}

/**
 * ユーザー本体（userBio）+ そのユーザーが著者だった全ガイドの翻訳キャッシュ行を削除する
 * （アカウント削除時に呼ぶ。deleteUserAccount() の内部実装）。guideIds が空なら guide 側の削除はスキップする。
 */
export async function deleteTranslationsForUser(
  db: DatabaseOrTransaction,
  userId: string,
  guideIds: string[],
): Promise<void> {
  await db
    .delete(contentTranslations)
    .where(and(eq(contentTranslations.targetType, "userBio"), eq(contentTranslations.targetId, userId)));

  if (guideIds.length === 0) return;
  await db
    .delete(contentTranslations)
    .where(and(eq(contentTranslations.targetType, "guide"), inArray(contentTranslations.targetId, guideIds)));
}

/** list() をページングしながら指定 prefix の Blob の pathname を全件列挙する */
async function listAllPathnamesByPrefix(prefix: string): Promise<string[]> {
  const blobs = await listAllBlobs({ prefix });
  return blobs.map((blob) => blob.pathname);
}

/**
 * pathname/url を 100 件ずつ del() する。バッチ単位で失敗しても残りは続行する
 * （scripts/delete-orphan-blobs.ts と同じパターン。失敗分はログのみでスクリプト側の
 * 手動回収に委ねる）。
 */
async function deleteBlobsInBatches(urlsOrPathnames: string[]): Promise<void> {
  await delBlobsInBatches(urlsOrPathnames, {
    onBatchError: (batch, error) => {
      console.error(`[content-cleanup] Failed to delete ${batch.length} blob(s):`, error);
    },
  });
}

/**
 * アカウント削除時: そのユーザー名前空間の Blob（ガイド一式 + スキン）を一括削除する。
 * `guides/<userId>/` と `skins/<userId>/` の 2 prefix を全列挙して削除するため、
 * 著者の全ガイド（本文画像・カバー・ドラフト分含む）を丸ごと消せる。
 *
 * `BLOB_READ_WRITE_TOKEN` 未設定（ローカル開発）なら何もしない no-op。絶対に throw しない。
 */
export async function cleanupUserBlobs({
  userId,
  customSkinUrl,
}: {
  userId: string;
  customSkinUrl: string | null;
}): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;

  try {
    const [guidePathnames, skinPathnames] = await Promise.all([
      listAllPathnamesByPrefix(`guides/${userId}/`),
      listAllPathnamesByPrefix(`skins/${userId}/`),
    ]);
    await deleteBlobsInBatches([...guidePathnames, ...skinPathnames]);

    // 規約前パス（prefix に乗らなかった場合）の保険。del() は冪等なので、
    // prefix 削除で既に消えていても二重削除にはならない
    if (isVercelBlobUrl(customSkinUrl)) {
      try {
        await del(customSkinUrl as string);
      } catch (error) {
        console.error(`[content-cleanup] Failed to delete custom skin blob for user ${userId}:`, error);
      }
    }
  } catch (error) {
    console.error(`[content-cleanup] Failed to clean up blobs for user ${userId}:`, error);
  }
}

/**
 * ガイド削除時: `guides/<userId>/<guideId>/` 配下の Blob と、削除された行の
 * 本文/カバー/ドラフト列が参照していた `guides/<userId>/` 配下の Blob をあわせて削除する。
 *
 * ただし著者の残ガイド（他ガイド・ドラフト）がまだ参照しているパスは保護し、削除対象から
 * 外す（同一著者内のコピー参照を壊さないため）。他ユーザーの名前空間
 * （`guides/<別userId>/…`）は候補にすら入らないため絶対に触らない。
 * 他ユーザーのガイドへコピーされた画像参照までは保護しない（cross-user 参照は
 * 現状のカバー画像即時削除と同じ意味論として許容。docs/guides.md 参照）。
 *
 * `BLOB_READ_WRITE_TOKEN` 未設定なら何もしない no-op。絶対に throw しない。
 */
export async function cleanupGuideBlobs({
  userId,
  guideId,
  guideColumns,
}: {
  userId: string;
  guideId: string;
  guideColumns: {
    content: string;
    draftContent: string | null;
    coverImageUrl: string | null;
    draftCoverImageUrl: string | null;
  };
}): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;

  try {
    const userPrefix = `guides/${userId}/`;
    const guidePrefix = `${userPrefix}${guideId}/`;

    const guideDirPathnames = await listAllPathnamesByPrefix(guidePrefix);
    const referencedPathnames = collectBlobPathnames([
      guideColumns.content,
      guideColumns.draftContent,
      guideColumns.coverImageUrl,
      guideColumns.draftCoverImageUrl,
    ]);

    const candidates = new Set<string>(guideDirPathnames);
    for (const pathname of referencedPathnames) {
      // 他ユーザーの名前空間は絶対に消さない（本文コピペ等で万一混入していても除外する）
      if (pathname.startsWith(userPrefix)) candidates.add(pathname);
    }
    if (candidates.size === 0) return;

    // 保護: 著者の残ガイド（呼び出し時点で対象行は削除済みなので、残存全件=他ガイド）が
    // 参照しているパスは削除対象から外す。
    // Blob ホスト文字列を含まない行は保護判定に影響しないため、事前に LIKE で絞り込んで
    // 本文転送を削減する（候補 pathname ごとの LIKE 絞りは percent-encoding 不一致で
    // 誤削除を招くため行わない。ホスト文字列一致のみの粗い絞り込み）
    const db = createDb();
    const remainingGuides = await db.query.guides.findMany({
      where: and(
        eq(guides.authorId, userId),
        or(
          like(guides.content, "%blob.vercel-storage.com%"),
          like(guides.draftContent, "%blob.vercel-storage.com%"),
          like(guides.coverImageUrl, "%blob.vercel-storage.com%"),
          like(guides.draftCoverImageUrl, "%blob.vercel-storage.com%"),
        ),
      ),
      columns: {
        content: true,
        draftContent: true,
        coverImageUrl: true,
        draftCoverImageUrl: true,
      },
    });
    const protectedPathnames = collectBlobPathnames(
      remainingGuides.flatMap((g) => [g.content, g.draftContent, g.coverImageUrl, g.draftCoverImageUrl]),
    );

    const toDelete = [...candidates].filter((pathname) => !protectedPathnames.has(pathname));
    if (toDelete.length === 0) return;

    await deleteBlobsInBatches(toDelete);
  } catch (error) {
    console.error(`[content-cleanup] Failed to clean up blobs for guide ${guideId}:`, error);
  }
}

/**
 * アカウント削除の合成ドメイン操作。派生データの削除（著者だったガイドの翻訳キャッシュ +
 * userBio翻訳 + favorites孤児行）と本体削除（users + better-auth 3テーブル）を単一の
 * db.transaction() で原子化する。どこかが失敗すれば全体がロールバックされ、
 * 「他ユーザーが押した favorites 行だけ消えた」のような復元不能な部分状態を防ぐ。
 *
 * トランザクション成功後、Vercel Blob 実体の削除（cleanupUserBlobs）を runAfterResponse()
 * 経由でスケジュールする（呼び出し側で別途 runAfterResponse を呼ぶ必要はない）。
 *
 * `user` は `db.query.users.findFirst({ where: eq(users.discordId, session.user.id) })` 等で
 * 取得した本人の行（id/slug/customSkinUrl を使う）。`sessionUserId` は better-auth 側の
 * ユーザーID（session.user.id。users とは FK で結ばれておらず、通常 user.discordId と同値）。
 */
export async function deleteUserAccount(
  db: Database,
  {
    user,
    sessionUserId,
  }: {
    user: { id: string; slug: string; customSkinUrl: string | null };
    sessionUserId: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    // 派生データの掃除は users 削除より前に実施する（users を消すと guides が cascade で
    // 消えてしまい、著者のガイド一覧を後から引けなくなるため）
    const userGuides = await tx.query.guides.findMany({
      where: eq(guides.authorId, user.id),
      columns: { id: true },
    });
    await deleteTranslationsForUser(tx, user.id, userGuides.map((g) => g.id));
    // 他ユーザーが自分を favorite していた孤児行を削除（自分が押した側は userId FK cascade で消える）
    await tx.delete(favorites).where(eq(favorites.favoriteSlug, user.slug));

    // users 本体（cascade で大半の関連テーブルが消える）
    await tx.delete(users).where(eq(users.id, user.id));

    // better-auth 側のテーブル（users と FK 無し。discordId = sessionUserId で引く）
    await tx.delete(authSessions).where(eq(authSessions.userId, sessionUserId));
    await tx.delete(authAccounts).where(eq(authAccounts.userId, sessionUserId));
    await tx.delete(authUsers).where(eq(authUsers.id, sessionUserId));
  });

  // Vercel Blob 実体（ガイド一式・カスタムスキン）はレスポンス後に best-effort で削除する
  runAfterResponse(cleanupUserBlobs({ userId: user.id, customSkinUrl: user.customSkinUrl }));
}

/**
 * ガイド削除の合成ドメイン操作。翻訳キャッシュ行の削除と guides 行本体の削除を単一の
 * db.transaction() で原子化する。トランザクション成功後、Vercel Blob 実体の削除
 * （cleanupGuideBlobs）を runAfterResponse() 経由でスケジュールする（呼び出し側で別途
 * runAfterResponse を呼ぶ必要はない）。
 *
 * `guide` は所有権確認込みで取得済みの行（`db.query.guides.findFirst({ where: and(eq(guides.id, ...),
 * eq(guides.authorId, ...)) })` 等）をそのまま渡す。
 */
export async function deleteGuide(
  db: Database,
  guide: {
    id: string;
    authorId: string;
    content: string;
    draftContent: string | null;
    coverImageUrl: string | null;
    draftCoverImageUrl: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await deleteTranslationsForGuide(tx, guide.id);
    await tx.delete(guides).where(eq(guides.id, guide.id));
  });

  // Vercel Blob 実体（本文画像・カバー・ドラフトカバー）はレスポンス後に best-effort で削除する
  runAfterResponse(
    cleanupGuideBlobs({
      userId: guide.authorId,
      guideId: guide.id,
      guideColumns: {
        content: guide.content,
        draftContent: guide.draftContent,
        coverImageUrl: guide.coverImageUrl,
        draftCoverImageUrl: guide.draftCoverImageUrl,
      },
    }),
  );
}
