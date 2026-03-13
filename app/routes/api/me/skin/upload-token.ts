import type { ActionFunctionArgs } from "react-router";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { getSession } from "@/lib/session";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

// POST /api/me/skin/upload-token
// Client Uploadのためのトークンを発行
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

  try {
    const body = (await request.json()) as HandleUploadBody;

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // パスがユーザーのスキンディレクトリ内であることを確認
        const expectedPrefix = `skins/${user.id}/`;
        if (!pathname.startsWith(expectedPrefix)) {
          throw new Error("Invalid upload path");
        }

        return {
          allowedContentTypes: ["image/png"],
          maximumSizeInBytes: 1 * 1024 * 1024, // 1MB
          tokenPayload: JSON.stringify({
            userId: user.id,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // アップロード完了後のコールバック
        // 注意: この時点ではDBを更新しない
        // クライアントが別途 /api/me/skin にPOSTしてURLを保存する
        console.log("Skin uploaded:", blob.url, tokenPayload);
      },
    });

    return new Response(JSON.stringify(jsonResponse), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Upload token error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Upload failed",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
