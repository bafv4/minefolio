// プロフィール絵文字リアクションの追加・解除API（docs/profile-reactions.md）。
//
// api/likes.ts と同骨格の JSON リソースルート（フォーム action にすると profile loader が
// クリックのたびに再検証されるため）。
//
// レート制限は設けない。ユニーク索引（profileUserId, emoji, reactorUserId）により
// 1ユーザー1対象1絵文字1件が上限で、濫用の天井は「アカウント数 × 8絵文字」になる
// （likes.ts と同じ考え方）。CSRF姿勢も likes.ts と同じ。

import type { Route } from "./+types/profile-reactions";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { apiJsonResponse, getApiUser } from "@/lib/api-auth.server";
import { isProfileReactionEmoji } from "@/lib/profile-reactions";
import { setProfileReaction } from "@/lib/profile-reactions.server";

/** profileUserId の長さ上限（CUID2 は 24〜32 文字。過大なボディを弾く） */
const MAX_PROFILE_USER_ID_LENGTH = 64;

export async function action({ request }: Route.ActionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return apiJsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const user = await getApiUser(db, auth, request);
  // 未オンボーディング（セッションはあるが users 行が無い）も未ログイン扱い
  if (!user) {
    return apiJsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { profileUserId?: unknown; emoji?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiJsonResponse({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return apiJsonResponse({ error: "Invalid request" }, { status: 400 });
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
    return apiJsonResponse({ error: "Invalid request" }, { status: 400 });
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
    return apiJsonResponse({ error: "Not found" }, { status: 404 });
  }

  return apiJsonResponse({ reacted: result.reacted, count: result.count });
}
