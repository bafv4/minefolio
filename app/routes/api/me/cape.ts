import { errorSummary } from "@/lib/error-summary";
import type { ActionFunctionArgs } from "react-router";
import { del } from "@vercel/blob";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { plainJsonResponse, requireApiUser } from "@/lib/api-auth.server";
import { isVercelBlobUrl } from "@/lib/blob-url";
import { isOwnTextureBlob } from "@/lib/blob-ownership.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

// POST /api/me/cape - カスタムマントURLを保存
// DELETE /api/me/cape - カスタムマントを削除
// （/api/me/skin と同じ構成。capeDisplay は me/edit の保存フォーム側で扱うためここでは触らない）
export async function action({ request }: ActionFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // 認証チェック（未ログイン 401 / users 行なし 404）
  const { user, response } = await requireApiUser(db, auth, request, ["customCapeUrl"]);
  if (!user) return response;

  const method = request.method.toUpperCase();

  // DELETE: カスタムマントを削除
  if (method === "DELETE") {
    try {
      // 既存のBlobを削除。自分のディレクトリ配下でない URL（過去に保存された他人のパス・他ストア）は
      // del() せず、列のクリアだけ行う
      if (user.customCapeUrl && isOwnTextureBlob(user.customCapeUrl, { userId: user.id, kind: "cape" })) {
        try {
          await del(user.customCapeUrl);
        } catch (e) {
          // Blob削除に失敗しても続行（既に存在しない可能性）
          console.warn("Failed to delete blob:", e);
        }
      }

      // DBからカスタムマント情報をクリア
      await db
        .update(users)
        .set({
          customCapeUrl: null,
          customCapeUpdatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return plainJsonResponse({ success: true });
    } catch (error) {
      console.error("Delete cape error:", errorSummary(error));
      return plainJsonResponse({ error: "Failed to delete cape" }, { status: 500 });
    }
  }

  // POST: カスタムマントURLを保存
  if (method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return plainJsonResponse({ error: "Invalid JSON" }, { status: 400 });
    }
    if (body === null || typeof body !== "object") {
      return plainJsonResponse({ error: "Invalid request" }, { status: 400 });
    }

    const { url } = body as { url?: unknown };

    if (!url || typeof url !== "string") {
      return plainJsonResponse({ error: "URL is required" }, { status: 400 });
    }

    try {
      // URLがVercel Blobのものか確認。
      // 部分文字列一致（includes）はフラグメント等ですり抜けられるため、
      // new URL() でパースしてホスト名を許可リスト判定する（SSRF 対策）。
      if (!isVercelBlobUrl(url)) {
        return plainJsonResponse({ error: "Invalid blob URL" }, { status: 400 });
      }
      // 自分のストア・自分のディレクトリ（capes/<userId>/）配下だけ受け付ける。
      // 他人の Blob を保存すると、解除・差し替え時に del() で消せてしまう
      if (!isOwnTextureBlob(url, { userId: user.id, kind: "cape" })) {
        return plainJsonResponse({ error: "Invalid blob URL" }, { status: 400 });
      }

      // 古いBlobを削除（新しいものと異なる場合）。自分の物と確認できない旧 URL は del() しない
      if (user.customCapeUrl && user.customCapeUrl !== url && isOwnTextureBlob(user.customCapeUrl, { userId: user.id, kind: "cape" })) {
        try {
          await del(user.customCapeUrl);
        } catch (e) {
          console.warn("Failed to delete old blob:", e);
        }
      }

      // DBを更新
      await db
        .update(users)
        .set({
          customCapeUrl: url,
          customCapeUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return plainJsonResponse({ success: true, customCapeUrl: url });
    } catch (error) {
      console.error("Save cape error:", errorSummary(error));
      return plainJsonResponse({ error: "Failed to save cape" }, { status: 500 });
    }
  }

  return plainJsonResponse({ error: "Method not allowed" }, { status: 405 });
}
