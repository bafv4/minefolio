import type { ActionFunctionArgs } from "react-router";
import { del } from "@vercel/blob";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

// POST /api/me/skin - カスタムスキンURLを保存
// DELETE /api/me/skin - カスタムスキンを削除
export async function action({ context, request }: ActionFunctionArgs) {
  const env = context.env ?? getEnv();
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
    try {
      const body = await request.json();
      const { url, model } = body as {
        url: string;
        model?: "default" | "slim";
      };

      if (!url) {
        return new Response(JSON.stringify({ error: "URL is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // URLがVercel Blobのものか確認
      if (!url.includes("blob.vercel-storage.com")) {
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
          customSkinModel: model ?? "default",
          customSkinUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      return new Response(
        JSON.stringify({
          success: true,
          customSkinUrl: url,
          customSkinModel: model ?? "default",
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
