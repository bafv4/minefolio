// Vercel Blob URL の検証（SSRF 対策の唯一の判定ロジック）。
//
// カスタムスキンの URL は、保存時（POST /api/me/skin）と取得時（GET /api/skin の
// サーバー side fetch）の両方でここを通す。過去は `url.includes("blob.vercel-storage.com")`
// の部分文字列一致だったため、`https://169.254.169.254/latest/meta-data/#blob.vercel-storage.com`
// のような URL（フラグメントに正規ホストを混ぜる）や `https://blob.vercel-storage.com.evil.com/`、
// `https://evil.com/?x=blob.vercel-storage.com` などがすり抜け、内部エンドポイントへの
// サーバー side リクエスト（SSRF）を許していた。

// アップロード済み公開 Blob の URL は必ず
// `https://<storeId>.public.blob.vercel-storage.com/<path>` の形になり、
// ホスト名はこのドメインの完全一致またはサブドメインになる。
const VERCEL_BLOB_HOST = "blob.vercel-storage.com";

/** ホスト名が信頼された Vercel Blob ホスト、またはそのサブドメインか（大文字小文字は無視）。 */
function isTrustedBlobHostname(hostname: string): boolean {
  // FQDN 末尾のドット（例: "...vercel-storage.com."）を正規化してから比較する。
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === VERCEL_BLOB_HOST || host.endsWith(`.${VERCEL_BLOB_HOST}`);
}

/**
 * ホスト名が IP リテラル（IPv4 / IPv6）かどうか。正規の Blob URL は常にドメイン名なので、
 * リンクローカル・プライベートを含め IP リテラルは一律で拒否する（多層防御）。
 */
function isIpLiteralHostname(hostname: string): boolean {
  // new URL() は IPv6 を角括弧付き（例: "[::1]"）で返す。ドメイン名にコロンは現れない。
  if (hostname.includes(":")) return true;
  // ドット区切りの数字のみ（"169.254.169.254" 等）は IPv4 リテラルとみなす。
  return /^\d+(\.\d+)*$/.test(hostname);
}

/**
 * 信頼できる Vercel Blob URL のときだけ、正規化した URL 文字列を返す。それ以外は null。
 *
 * `new URL()` でパースして **ホスト名（`hostname`）** を厳密に判定するため、
 * URL のフラグメント・クエリ・userinfo（`@`）に正規ホスト名を紛れ込ませても
 * ホスト名部分には現れず、部分文字列一致のようなすり抜けは成立しない。
 *
 * 判定順:
 *  1. パース不能 → null
 *  2. https 以外 → null
 *  3. IP リテラルホスト → null
 *  4. 信頼された Blob ホスト（完全一致/サブドメイン）以外 → null
 */
export function parseVercelBlobUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (isIpLiteralHostname(parsed.hostname)) return null;
  if (!isTrustedBlobHostname(parsed.hostname)) return null;

  return parsed.toString();
}

/** `parseVercelBlobUrl` の真偽値版。保存時のバリデーションに使う。 */
export function isVercelBlobUrl(value: string | null | undefined): boolean {
  return parseVercelBlobUrl(value) !== null;
}

// ── Blob URL → pathname 変換・本文からの抽出 ──────────────────────────
//
// 監査/削除スクリプト（scripts/lib/blob-refs.ts）と削除経路
// （app/lib/content-cleanup.server.ts）の双方が使う「参照判定」の単一実装。
// list() が返す pathname（先頭スラッシュ無し・デコード済み）に揃える。

/**
 * Blob の URL からパスを取り出して正規化する。
 * list() が返す pathname は先頭スラッシュ無し・デコード済みなので、それに揃える。
 * パース不能な URL は null を返す。
 */
export function blobUrlToPathname(rawUrl: string): string | null {
  try {
    return decodeURIComponent(new URL(rawUrl).pathname).replace(/^\//, "");
  } catch {
    return null;
  }
}

/**
 * 本文 HTML などから Blob URL を全部拾う。
 *
 * ホスト部は `(?:[a-z0-9-]+\.)*blob\.vercel-storage\.com`（サブドメインは必ず `.` で
 * 区切られたラベルの連続）で、サブドメイン境界を強制する。旧パターン
 * `[a-z0-9.-]*\.?blob\.vercel-storage\.com` は `.` 無しでも任意の文字列を直前に置けたため、
 * `evilblob.vercel-storage.com` のようなドット境界の無い偽ホストにも一致してしまっていた。
 */
const BLOB_URL_RE = /https:\/\/(?:[a-z0-9-]+\.)*blob\.vercel-storage\.com\/[^\s"'<>)\\]+/gi;

/**
 * 複数のテキスト（本文・カバー画像URL列など）から Blob URL を全て拾い、
 * pathname の集合にして返す（null/undefined は無視、重複は自動で排除）。
 */
export function collectBlobPathnames(texts: ReadonlyArray<string | null | undefined>): Set<string> {
  const pathnames = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(BLOB_URL_RE)) {
      const pathname = blobUrlToPathname(match[0]);
      if (pathname) pathnames.add(pathname);
    }
  }
  return pathnames;
}

// ── スキン・マントの所有判定 ───────────────────────────────────────────
//
// `isVercelBlobUrl` はホストが Blob ドメインかしか見ないため、他人のスキン・ガイド画像・
// 別ストアの URL も通る。保存した URL は解除・差し替え・アカウント削除で `del()` に渡るので、
// 他人の Blob を消せてしまう。保存時・削除時とも、ここの判定を通ったものだけを扱う。

/** テクスチャ種別ごとの Blob パスの先頭ディレクトリ（トークン発行側と判定側の単一情報源）。 */
export const TEXTURE_BLOB_PREFIX = { skin: "skins", cape: "capes" } as const;
export type TextureKind = keyof typeof TEXTURE_BLOB_PREFIX;

/** `<prefix>/<userId>/`（アップロードを許可するパスの先頭）。 */
export function userTexturePrefix(kind: TextureKind, userId: string): string {
  return `${TEXTURE_BLOB_PREFIX[kind]}/${userId}/`;
}

/**
 * `BLOB_READ_WRITE_TOKEN`（`vercel_blob_rw_<storeId>_<secret>`）からストア ID を取り出す。
 * @vercel/blob の parseStoreIdFromReadWriteToken と同じ（"_" 区切りの4つ目）。取れなければ空文字。
 */
export function storeIdFromBlobToken(token: string): string {
  const [, , , storeId = ""] = token.split("_");
  return storeId;
}

/**
 * URL が「このユーザーの種別ディレクトリ配下の Blob」か。
 * - パスが `<prefix>/<userId>/` で始まり、その下に名前があり、`..` セグメントを含まない
 * - `storeId` を渡したときは、ホストが自ストア（`<storeId>.public|private.blob.vercel-storage.com`）であること
 *   （渡さない＝トークン無しのローカル環境ではパスだけを確認する。空文字は fail closed）
 */
export function isOwnTextureBlobUrl(
  url: string | null | undefined,
  { userId, kind, storeId }: { userId: string; kind: TextureKind; storeId?: string },
): boolean {
  const safe = parseVercelBlobUrl(url);
  if (!safe) return false;

  const pathname = blobUrlToPathname(safe);
  if (!pathname) return false;
  const prefix = userTexturePrefix(kind, userId);
  if (!pathname.startsWith(prefix) || pathname.length === prefix.length) return false;
  if (pathname.split("/").includes("..")) return false;

  if (storeId !== undefined) {
    if (!storeId) return false;
    const host = new URL(safe).hostname.toLowerCase().replace(/\.$/, "");
    const id = storeId.toLowerCase();
    if (host !== `${id}.public.blob.vercel-storage.com` && host !== `${id}.private.blob.vercel-storage.com`) {
      return false;
    }
  }
  return true;
}
