import type { Route } from "./+types/favorites";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import {
  buildLegacyFavoritesCookieDeletion,
  getFavoritesFromDb,
  addFavoriteToDb,
  removeFavoriteFromDb,
  syncLocalFavoritesToDb,
} from "@/lib/favorites";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  // 旧 minefolio_favorites Cookie を自動削除（残っていれば）
  headers.append("Set-Cookie", buildLegacyFavoritesCookieDeletion());
  return new Response(JSON.stringify(body), { ...init, headers });
}

async function getCurrentUser(request: Request, context: Route.LoaderArgs["context"]) {
  const env = context.env ?? getEnv();
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

/**
 * GET /api/favorites
 * - 認証済み: DB から slug 一覧を取得
 * - 未認証: 空配列を返す
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { db, user } = await getCurrentUser(request, context);
  if (!user) {
    return jsonResponse({ favorites: [] });
  }
  const list = await getFavoritesFromDb(db, user.id);
  return jsonResponse({ favorites: list });
}

/**
 * POST /api/favorites { slug, action: "add" | "remove" }
 *   → 認証必須、お気に入りを追加/削除して最新リストを返す
 *
 * PUT /api/favorites { slugs: string[] }
 *   → 認証必須、localStorage→DBの一括同期（重複は無視）
 */
export async function action({ context, request }: Route.ActionArgs) {
  const { db, user } = await getCurrentUser(request, context);
  if (!user) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }

  const method = request.method.toUpperCase();

  if (method === "POST") {
    let body: { slug?: unknown; action?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
    }
    const slug = typeof body.slug === "string" ? body.slug : "";
    const actionType = body.action;
    if (!slug || (actionType !== "add" && actionType !== "remove")) {
      return jsonResponse({ error: "Invalid request" }, { status: 400 });
    }
    if (actionType === "add") {
      // slug が実在するユーザーか確認（架空 slug の孤児エントリ防止）
      const targetUser = await db.query.users.findFirst({
        where: eq(users.slug, slug),
        columns: { id: true },
      });
      if (!targetUser) {
        return jsonResponse({ error: "User not found" }, { status: 404 });
      }
      await addFavoriteToDb(db, user.id, slug);
    } else {
      await removeFavoriteFromDb(db, user.id, slug);
    }
    const list = await getFavoritesFromDb(db, user.id);
    return jsonResponse({ favorites: list });
  }

  if (method === "PUT") {
    let body: { slugs?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
    }
    // 巨大配列による過負荷を防ぐため、妥当な slug のみを最大500件に制限する。
    const slugs = Array.isArray(body.slugs)
      ? body.slugs
          .filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 128)
          .slice(0, 500)
      : [];
    await syncLocalFavoritesToDb(db, user.id, slugs);
    const list = await getFavoritesFromDb(db, user.id);
    return jsonResponse({ favorites: list });
  }

  return jsonResponse({ error: "Method not allowed" }, { status: 405 });
}
