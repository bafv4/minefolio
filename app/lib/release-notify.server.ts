/**
 * リリース通知（Vercel Webhook → Discord）の純関数ユーティリティ
 * エンドポイント本体は app/routes/api/webhooks/vercel.ts
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { parseChangelog } from "./changelog";

/** Discord embed の description 上限は4096文字。余裕を持って切り詰める */
const EMBED_DESCRIPTION_LIMIT = 3900;

/** Vercel Webhook の署名検証（x-vercel-signature = ボディの HMAC-SHA1 hex） */
export function verifyVercelSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha1", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

/** changelog.md から該当バージョンの本文を Discord embed 向けに整形する */
export function buildReleaseDescription(
  changelogMd: string,
  version: string,
  changelogUrl: string,
): string {
  const entry = parseChangelog(changelogMd).find((e) => e.version === version);
  if (!entry) {
    return `チェンジログは ${changelogUrl} をご覧ください。`;
  }
  // "### 見出し" は embed 内では見出しにならないため太字に変換する
  const body = entry.body.replace(/^### (.+)$/gm, "**$1**");
  return body.slice(0, EMBED_DESCRIPTION_LIMIT);
}
