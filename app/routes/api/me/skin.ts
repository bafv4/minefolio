import type { ActionFunctionArgs } from "react-router";
import { del } from "@vercel/blob";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { isVercelBlobUrl } from "@/lib/blob-url";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

// POST /api/me/skin - カスタムスキンURLを保存
// DELETE /api/me/skin - カスタムスキンを削除
export async function action({ request }: ActionFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // 認証チェック
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ユーザー取得
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const method = request.method.toUpperCase();

  // DELETE: カスタムスキンを削除
  if (method === "DELETE") {
    try {
      // 既存のBlobを削除
      if (user.customSkinUrl) {
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

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Delete skin error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to delete skin" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  // POST: カスタムスキンURLを保存
  if (method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (body === null || typeof body !== "object") {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { url, model } = body as { url?: unknown; model?: unknown };

    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // model は列の enum 許可リスト（schema.ts の customSkinModel: "default" | "slim"）
    // でのみ受け付ける。任意文字列が enum 列に永続化されるのを防ぐ。
    const allowedModels: readonly string[] = users.customSkinModel.enumValues;
    if (
      model !== undefined &&
      (typeof model !== "string" || !allowedModels.includes(model))
    ) {
      return new Response(JSON.stringify({ error: "Invalid model" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const validatedModel = (model as "default" | "slim" | undefined) ?? "default";

    try {
      // URLがVercel Blobのものか確認。
      // 部分文字列一致（includes）はフラグメント等ですり抜けられるため、
      // new URL() でパースしてホスト名を許可リスト判定する（SSRF 対策）。
      if (!isVercelBlobUrl(url)) {
        return new Response(JSON.stringify({ error: "Invalid blob URL" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 古いBlobを削除（新しいものと異なる場合）
      if (user.customSkinUrl && user.customSkinUrl !== url) {
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

      return new Response(
        JSON.stringify({
          success: true,
          customSkinUrl: url,
          customSkinModel: validatedModel,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("Save skin error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to save skin" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
