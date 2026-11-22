// スキン・マントの Blob URL がこのユーザー自身のものかの判定（env を読む部分）。
// 純粋な判定は blob-url.ts の isOwnTextureBlobUrl。ここでは BLOB_READ_WRITE_TOKEN からストア ID を導出して渡す。
// トークンが無い環境（ローカルで Blob 未設定）ではパスだけを確認する。

import { getEnv } from "./env.server";
import { isOwnTextureBlobUrl, storeIdFromBlobToken, type TextureKind } from "./blob-url";

export function isOwnTextureBlob(
  url: string | null | undefined,
  { userId, kind }: { userId: string; kind: TextureKind },
): boolean {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  return isOwnTextureBlobUrl(url, {
    userId,
    kind,
    storeId: token ? storeIdFromBlobToken(token) : undefined,
  });
}
