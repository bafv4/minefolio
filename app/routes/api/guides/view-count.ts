// ガイド閲覧数の加算API
//
// 閲覧数は /guides/:authorSlug/:guideSlug の loader では数えない。原文/訳文の切替
// （?original=1）などの同一ページ内の search param 変更でも loader が再実行され、
// 切替のたびに閲覧数が増えてしまうため。ガイド閲覧ページがマウントされたとき
// （＝1回のページ訪問）にクライアントから1回だけ POST する。
// JS を実行しないクローラは数えない（人間の閲覧数に近づく方向の変更）。
// 認証は不要（セッションがあれば読み、著者本人の閲覧は加算しない）。公開済みガイドの id のみ加算し、ドラフトプレビューはクライアント側で送らない。
// CSRF は副作用が閲覧数の +1 のみのため /api/likes のような認証は設けず、
// JSON Content-Type 必須（クロスオリジンはプリフライトが必要）に留める。

import type { Route } from "./+types/view-count";
import { eq, and, sql } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { guides } from "@/lib/schema";
import { apiJsonResponse } from "@/lib/api-auth.server";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";

const MAX_GUIDE_ID_LENGTH = 64;

export async function action({ request }: Route.ActionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return apiJsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let body: { guideId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiJsonResponse({ error: "Invalid JSON" }, { status: 400 });
  }
  const guideId = body && typeof body.guideId === "string" ? body.guideId : "";
  if (!guideId || guideId.length > MAX_GUIDE_ID_LENGTH) {
    return apiJsonResponse({ error: "Invalid request" }, { status: 400 });
  }

  const db = createDb();

  // 著者本人の閲覧は数えない（セッションの Discord ID がガイドの著者のものなら加算しない）。未ログインは数える。
  // IP などは記録しない。
  const auth = createAuth(db, getEnv());
  const session = await getOptionalSession(request, auth).catch(() => null);
  if (session?.user?.id) {
    const guide = await db.query.guides.findFirst({
      where: and(eq(guides.id, guideId), eq(guides.isPublished, true)),
      columns: { id: true },
      with: { author: { columns: { discordId: true } } },
    });
    if (!guide) return apiJsonResponse({ success: true });
    if (guide.author?.discordId === session.user.id) {
      return apiJsonResponse({ success: true });
    }
  }

  await db
    .update(guides)
    .set({ viewCount: sql`${guides.viewCount} + 1` })
    .where(and(eq(guides.id, guideId), eq(guides.isPublished, true)));

  return apiJsonResponse({ success: true });
}
