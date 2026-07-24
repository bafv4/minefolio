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
