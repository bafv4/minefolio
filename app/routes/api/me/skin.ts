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

// POST /api/me/skin - カスタムスキンURLを保存
// DELETE /api/me/skin - カスタムスキンを削除
export async function action({ request }: ActionFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // 認証チェック（未ログイン 401 / users 行なし 404）
  const { user, response } = await requireApiUser(db, auth, request, ["customSkinUrl"]);
  if (!user) return response;

  const method = request.method.toUpperCase();

  // DELETE: カスタムスキンを削除
  if (method === "DELETE") {
    try {
      // 既存のBlobを削除。自分のディレクトリ配下でない URL（過去に保存された他人のパス・他ストア）は
      // del() せず、列のクリアだけ行う
      if (user.customSkinUrl && isOwnTextureBlob(user.customSkinUrl, { userId: user.id, kind: "skin" })) {
        try {
          await del(user.customSkinUrl);
        } catch (e) {
          // Blob削除に失敗しても続行（既に存在しない可能性）
          console.warn("Failed to delete blob:", e);
        }
      }

      // DBからカスタムスキン情報をクリア
      await db
        .update(users)
        .set({
          customSkinUrl: null,
          customSkinModel: null,
          customSkinUpdatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return plainJsonResponse({ success: true });
    } catch (error) {
      console.error("Delete skin error:", errorSummary(error));
      return plainJsonResponse({ error: "Failed to delete skin" }, { status: 500 });
    }
  }

  // POST: カスタムスキンURLを保存
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

    const { url, model } = body as { url?: unknown; model?: unknown };

    if (!url || typeof url !== "string") {
      return plainJsonResponse({ error: "URL is required" }, { status: 400 });
    }

    // model は列の enum 許可リスト（schema.ts の customSkinModel: "default" | "slim"）
    // でのみ受け付ける。任意文字列が enum 列に永続化されるのを防ぐ。
    const allowedModels: readonly string[] = users.customSkinModel.enumValues;
    if (
      model !== undefined &&
      (typeof model !== "string" || !allowedModels.includes(model))
    ) {
      return plainJsonResponse({ error: "Invalid model" }, { status: 400 });
    }
    const validatedModel = (model as "default" | "slim" | undefined) ?? "default";

    try {
      // URLがVercel Blobのものか確認。
      // 部分文字列一致（includes）はフラグメント等ですり抜けられるため、
      // new URL() でパースしてホスト名を許可リスト判定する（SSRF 対策）。
      if (!isVercelBlobUrl(url)) {
        return plainJsonResponse({ error: "Invalid blob URL" }, { status: 400 });
      }
      // 自分のストア・自分のディレクトリ（skins/<userId>/）配下だけ受け付ける。
      // 他人の Blob を保存すると、解除・差し替え時に del() で消せてしまう
      if (!isOwnTextureBlob(url, { userId: user.id, kind: "skin" })) {
        return plainJsonResponse({ error: "Invalid blob URL" }, { status: 400 });
      }

      // 古いBlobを削除（新しいものと異なる場合）。自分の物と確認できない旧 URL は del() しない
      if (user.customSkinUrl && user.customSkinUrl !== url && isOwnTextureBlob(user.customSkinUrl, { userId: user.id, kind: "skin" })) {
        try {
          await del(user.customSkinUrl);
        } catch (e) {
          console.warn("Failed to delete old blob:", e);
        }
      }

      // DBを更新
      await db
        .update(users)
        .set({
          customSkinUrl: url,
          customSkinModel: validatedModel,
          customSkinUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return plainJsonResponse({
        success: true,
        customSkinUrl: url,
        customSkinModel: validatedModel,
      });
    } catch (error) {
      console.error("Save skin error:", errorSummary(error));
      return plainJsonResponse({ error: "Failed to save skin" }, { status: 500 });
    }
  }

  return plainJsonResponse({ error: "Method not allowed" }, { status: 405 });
}
