import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { inArray } from "drizzle-orm";

const MAX_SLUGS = 100;

/**
 * POST /api/users/by-slugs
 * Body: { slugs: string[] }
 * Response: { users: Array<{ slug, mcid, uuid, displayName, shortBio, location, updatedAt }> }
 *
 * 未ログインユーザーがlocalStorageのslug一覧から走者カードを取得するためのエンドポイント。
 * SSR表示で必要な最低限のフィールドのみ返す。
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { slugs?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const slugs = Array.isArray(body.slugs)
    ? body.slugs
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .slice(0, MAX_SLUGS)
    : [];

  if (slugs.length === 0) {
    return Response.json({ users: [] });
  }

  const db = createDb();
  const rows = await db.query.users.findMany({
    where: inArray(users.slug, slugs),
    columns: {
      slug: true,
      mcid: true,
      uuid: true,
      displayName: true,
      shortBio: true,
      location: true,
      updatedAt: true,
      customSkinUrl: true,
      slimSkin: true,
    },
  });

  // 入力順にソート
  const bySlug = new Map(rows.map((u) => [u.slug, u]));
  const sorted = slugs.map((s) => bySlug.get(s)).filter((u): u is NonNullable<typeof u> => u != null);

  return Response.json({ users: sorted });
}

// GET（補助、空応答）
export async function loader(_args: LoaderFunctionArgs) {
  return new Response(JSON.stringify({ error: "Use POST" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
