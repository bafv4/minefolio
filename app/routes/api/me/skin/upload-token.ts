import type { ActionFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { requireApiUser } from "@/lib/api-auth.server";
import { handleTextureUploadToken } from "@/lib/blob-storage.server";

// POST /api/me/skin/upload-token
// Client Uploadのためのトークンを発行（共通処理は handleTextureUploadToken）
export async function action({ request }: ActionFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const { user, response } = await requireApiUser(db, auth, request, []);
  if (!user) return response;

  return handleTextureUploadToken(request, {
    prefix: "skins",
    userId: user.id,
    logLabel: "Skin",
  });
}
