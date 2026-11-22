import type { ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { apiJsonResponse, requireApiUser } from "@/lib/api-auth.server";
import { ME_GUIDE_COLUMNS, parseMeGuideKind } from "@/lib/me-guide";
import { users } from "@/lib/schema";

// POST /api/me/guide - /me の初回ツアー・「はじめに」チェックリストの完了/閉じた日時を記録する
// （認証必須・自分の行だけを更新）。フォーム値 kind = "tour" | "checklist"。
export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return apiJsonResponse({ error: "Method Not Allowed" }, { status: 405 });
  }
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const { user, response } = await requireApiUser(db, auth, request, []);
  if (!user) return response;

  const formData = await request.formData().catch(() => null);
  const kind = parseMeGuideKind(formData?.get("kind"));
  if (!kind) return apiJsonResponse({ error: "Invalid kind" }, { status: 400 });

  const now = new Date();
  await db
    .update(users)
    .set({ [ME_GUIDE_COLUMNS[kind]]: now })
    .where(eq(users.id, user.id));
  return apiJsonResponse({ ok: true, kind });
}
