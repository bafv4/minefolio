// Vercel Blob の列挙（list）・バッチ削除（del）の共有実装。
//
// cursor ページング（limit 1000）・100件ずつのバッチ削除（バッチ単位で失敗しても続行）は
// app/lib/content-cleanup.server.ts（アカウント/ガイド削除時の Blob 実体掃除）と
// scripts/lib/blob-refs.ts・scripts/delete-orphan-blobs.ts（手動の孤児 Blob 回収）の
// 両方が同じパターンを必要とするため、ここに集約する。
//
// @vercel/blob を import するため .server サフィックスを付ける（クライアントバンドルへの
// 混入防止）。tsx 実行の scripts/ からも import 可（前例: scripts/lib/blob-refs.ts が
// app/lib/blob-url を import している）。

import { del, list, type ListBlobResultBlob } from "@vercel/blob";

/** Blob 削除のバッチサイズ（del() 1回あたりの件数） */
const DELETE_BATCH_SIZE = 100;

/**
 * list() をページングしながら全件列挙する。
 * `prefix` を指定すればその配下だけ、省略すればストア全体を対象にする。
 * `token` を省略した場合は @vercel/blob が `BLOB_READ_WRITE_TOKEN` 環境変数にフォールバックする。
 */
export async function listAllBlobs({
  prefix,
  token,
  onProgress,
}: {
  prefix?: string;
  token?: string;
  onProgress?: (count: number) => void;
} = {}): Promise<ListBlobResultBlob[]> {
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, token, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
    onProgress?.(blobs.length);
  } while (cursor);
  return blobs;
}

/**
 * pathname/url を `DELETE_BATCH_SIZE` 件ずつ del() する。バッチ単位で失敗しても残りは続行する。
 * `onBatchError` で失敗バッチを呼び出し側に通知でき、`onBatchSettled` で処理済み件数（成功+失敗の
 * 累計）を使った進捗表示ができる。戻り値は削除済み件数・失敗件数（失敗バッチの合計）。
 */
export async function delBlobsInBatches(
  urlsOrPathnames: string[],
  {
    token,
    onBatchError,
    onBatchSettled,
  }: {
    token?: string;
    onBatchError?: (batch: string[], error: unknown) => void;
    onBatchSettled?: (processedCount: number) => void;
  } = {},
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < urlsOrPathnames.length; i += DELETE_BATCH_SIZE) {
    const batch = urlsOrPathnames.slice(i, i + DELETE_BATCH_SIZE);
    try {
      // token 未指定のときは del() に options 自体を渡さない（token 無し呼び出しと完全に同じ
      // 引数形にする。@vercel/blob は token 省略時に BLOB_READ_WRITE_TOKEN 環境変数へ
      // フォールバックするため、{ token: undefined } を渡しても挙動は同じだが、
      // 呼び出し引数の形を既存呼び出し元と揃えておく）
      if (token) {
        await del(batch, { token });
      } else {
        await del(batch);
      }
      deleted += batch.length;
    } catch (error) {
      failed += batch.length;
      onBatchError?.(batch, error);
    }
    onBatchSettled?.(deleted + failed);
  }
  return { deleted, failed };
}
