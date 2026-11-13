import type { ActionFunctionArgs } from "react-router";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { plainJsonResponse, requireApiUser } from "@/lib/api-auth.server";

export async function action({ request }: ActionFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const { user, response } = await requireApiUser(db, auth, request, []);
  if (!user) return response;

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return plainJsonResponse({ error: "Invalid JSON" }, { status: 400 });
  }
  if (parsedBody === null || typeof parsedBody !== "object") {
    return plainJsonResponse({ error: "Invalid request" }, { status: 400 });
  }
  const body = parsedBody as HandleUploadBody;

  return handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname) => {
      // user は外側で検証済みだが、コールバック実行時の型ナロー目的で再確認
      if (!user || !user.id) {
        throw new Error("Unauthorized");
      }
      // パストラバーサル対策: 接頭辞一致に加え、'..' セグメントを含むパスを拒否する
      if (
        !pathname.startsWith(`guides/${user.id}/`) ||
        pathname.split("/").includes("..")
      ) {
        throw new Error("Invalid path");
      }
      return {
        allowedContentTypes: [
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
        ],
        // クライアント側で縮小・webp/jpeg 再エンコード済みだが、GIF 素通しや
        // 例外時の余裕として上限を確保する（use-image-upload の MAX_UPLOAD_BYTES と一致）。
        maximumSizeInBytes: 15 * 1024 * 1024,
        // カバー画像は固定パス（.../cover.<ext>）のため、同名 blob への再アップロードは
        // 既定（addRandomSuffix:false / allowOverwrite:false）だと「既に存在する」で失敗する。
        // ランダムサフィックスを付けて毎回一意パスにし、再試行の失敗と URL キャッシュを防ぐ。
        addRandomSuffix: true,
      };
    },
    onUploadCompleted: async ({ blob }) => {
      console.log("Guide image uploaded:", blob.url);
    },
  });
}
