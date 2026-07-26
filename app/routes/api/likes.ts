// いいねの追加・解除API（ガイド／サーチクラフトテンプレート）
//
// 一覧ページ（/guides・/guides/templates・ホーム・プロフィール）には action が無く、
// フォーム action にすると5箇所に複製した上でクリックのたびにそのページの loader が
// 再検証される（ホームでは外部API取得が走る）。そのため JSON リソースルートにする。
//
// レート制限は設けない。ユニーク索引により 1ユーザー1対象1件が上限で、
// 濫用の上限は「アカウント数」＝ favorites と同じ天井になるため。
// CSRF は /api/favorites と同じ姿勢（better-auth のセッションCookieが SameSite=Lax、
// かつ JSON Content-Type の要求でクロスオリジンはプリフライトが必要）。

import type { Route } from "./+types/likes";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { setLike, type LikeTargetType } from "@/lib/likes.server";

/** id の長さ上限（CUID2 は 24〜32 文字。過大なボディを弾く） */
const MAX_TARGET_ID_LENGTH = 64;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  // 閲覧者ごとに異なる応答なので、CDN・ブラウザともにキャッシュさせない
  headers.set("Cache-Control", "private, no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * セッションから内部ユーザーIDを解決する。
 * session.user.id は Discord ID なので users.discordId で引き直す。
 * getSession は throw redirect("/login") するため使わない（fetch が302を追って
 * 「200 + ログインHTML」を返し、res.json() が壊れる）。
 */
async function getCurrentUser(request: Request) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);
  if (!session) return { db, user: null };
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    columns: { id: true },
  });
  return { db, user };
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const { db, user } = await getCurrentUser(request);
  // 未オンボーディング（セッションはあるが users 行が無い）も未ログイン扱い
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { targetType?: unknown; targetId?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetType = body.targetType;
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  const actionType = body.action;

  if (
    (targetType !== "guide" && targetType !== "template") ||
    !targetId ||
    targetId.length > MAX_TARGET_ID_LENGTH ||
    (actionType !== "like" && actionType !== "unlike")
  ) {
    return jsonResponse({ error: "Invalid request" }, { status: 400 });
  }

  const result = await setLike(
    db,
    user.id,
    targetType as LikeTargetType,
    targetId,
    actionType === "like",
  );

  if (!result.ok) {
    if (result.reason === "self") {
      return jsonResponse({ error: "Cannot like own content" }, { status: 403 });
    }
    // 不存在・未公開・非公開著者はすべて同一の応答にする（存在の列挙オラクルにしない）
    return jsonResponse({ error: "Not found" }, { status: 404 });
  }

  return jsonResponse({ liked: result.liked, count: result.count });
}
