// アカウント削除・ガイド削除時の派生データ（Vercel Blob 実体・翻訳キャッシュ）の掃除。
//
// DB 系（deleteTranslationsFor*）は呼び出し側の action 内で await する同期処理。
// 失敗したら action ごと失敗してよい（本体の削除トランザクションと一貫性を保つため）。
//
// Blob 系（cleanup*Blobs）は絶対に throw しない best-effort。失敗しても
// アカウント削除・ガイド削除の本体（DB 行の削除）は完了させる方針
// （app/lib/targeted-refresh.server.ts の「絶対ブロック・失敗させない」設計を踏襲）。
// 呼び出し側は runAfterResponse() でレスポンス後に実行すること。
// 消し残した Blob は scripts/audit-orphan-blobs.ts / delete-orphan-blobs.ts が
// 後から拾える（docs/guides.md「参照されなくなった Blob の回収」参照）。

import { eq, and, inArray } from "drizzle-orm";
import { del, list } from "@vercel/blob";
import type { Database } from "./db";
import { createDb } from "./db";
import { contentTranslations, guides } from "./schema";
import { isVercelBlobUrl, collectBlobPathnames } from "./blob-url";

/** Blob 削除のバッチサイズ（scripts/delete-orphan-blobs.ts と同じ値） */
const DELETE_BATCH_SIZE = 100;

/** guides.id に紐づく翻訳キャッシュ行を削除する（ガイド削除時に呼ぶ） */
export async function deleteTranslationsForGuide(db: Database, guideId: string): Promise<void> {
  await db
    .delete(contentTranslations)
    .where(and(eq(contentTranslations.targetType, "guide"), eq(contentTranslations.targetId, guideId)));
}

/**
 * ユーザー本体（userBio）+ そのユーザーが著者だった全ガイドの翻訳キャッシュ行を削除する
 * （アカウント削除時に呼ぶ）。guideIds が空なら guide 側の削除はスキップする。
 */
export async function deleteTranslationsForUser(
  db: Database,
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
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const blob of page.blobs) pathnames.push(blob.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return pathnames;
}

/**
 * pathname/url を 100 件ずつ del() する。バッチ単位で失敗しても残りは続行する
 * （scripts/delete-orphan-blobs.ts と同じパターン。失敗分はログのみでスクリプト側の
 * 手動回収に委ねる）。
 */
async function deleteBlobsInBatches(urlsOrPathnames: string[]): Promise<void> {
  for (let i = 0; i < urlsOrPathnames.length; i += DELETE_BATCH_SIZE) {
    const batch = urlsOrPathnames.slice(i, i + DELETE_BATCH_SIZE);
    try {
      await del(batch);
    } catch (error) {
      console.error(`[content-cleanup] Failed to delete ${batch.length} blob(s):`, error);
    }
  }
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
    // 参照しているパスは削除対象から外す
    const db = createDb();
    const remainingGuides = await db.query.guides.findMany({
      where: eq(guides.authorId, userId),
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
