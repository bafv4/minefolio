// プロフィール絵文字リアクションの追加・解除API（docs/profile-reactions.md）。
//
// api/likes.ts と同骨格の JSON リソースルート（フォーム action にすると profile loader が
// クリックのたびに再検証されるため）。likes との最大の違いはフラグガードで、
// isProfileReactionsEnabled() が false の間はメソッド・認証より前に404を返し、
// DB（profile_reactions テーブル）には一切触れない（テーブル未作成の本番でも安全）。
//
// レート制限は設けない。ユニーク索引（profileUserId, emoji, reactorUserId）により
// 1ユーザー1対象1絵文字1件が上限で、濫用の天井は「アカウント数 × 8絵文字」になる
// （likes.ts と同じ考え方）。CSRF姿勢も likes.ts と同じ。

import type { Route } from "./+types/profile-reactions";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv, isProfileReactionsEnabled } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { isProfileReactionEmoji } from "@/lib/profile-reactions";
import { setProfileReaction } from "@/lib/profile-reactions.server";

/** profileUserId の長さ上限（CUID2 は 24〜32 文字。過大なボディを弾く） */
const MAX_PROFILE_USER_ID_LENGTH = 64;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  // 閲覧者ごとに異なる応答なので、CDN・ブラウザともにキャッシュさせない
  headers.set("Cache-Control", "private, no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * セッションから内部ユーザーIDを解決する（api/likes.ts の getCurrentUser と同型）。
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
  // ①フラグOFF: 存在自体を隠すため、メソッド・認証の判定より前に404を返す。
  // ここで return するため profile_reactions テーブル・users テーブルのいずれにも触れない。
  if (!isProfileReactionsEnabled()) {
    return jsonResponse({ error: "Not found" }, { status: 404 });
  }

  if (request.method.toUpperCase() !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const { db, user } = await getCurrentUser(request);
  // 未オンボーディング（セッションはあるが users 行が無い）も未ログイン扱い
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { profileUserId?: unknown; emoji?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
  }

  const profileUserId = typeof body.profileUserId === "string" ? body.profileUserId : "";
  const emoji = typeof body.emoji === "string" ? body.emoji : "";
  const actionType = body.action;

  if (
    !profileUserId ||
    profileUserId.length > MAX_PROFILE_USER_ID_LENGTH ||
    !isProfileReactionEmoji(emoji) ||
    (actionType !== "react" && actionType !== "unreact")
  ) {
    return jsonResponse({ error: "Invalid request" }, { status: 400 });
  }

  const result = await setProfileReaction(
    db,
    user.id,
    profileUserId,
    emoji,
    actionType === "react",
  );

  if (!result.ok) {
    // 不存在・非公開（本人以外）はすべて同一の応答にする（存在の列挙オラクルにしない）
    return jsonResponse({ error: "Not found" }, { status: 404 });
  }

  return jsonResponse({ reacted: result.reacted, count: result.count });
}
