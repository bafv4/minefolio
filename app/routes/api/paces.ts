// ペース一覧（/paces）の遅延ロード・無限スクロール用API
// クエリパラメータ: offset, limit（ページング）, q, split, from, to, maxTime（検索条件）

import type { Route } from "./+types/paces";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env.server";
import { getVisiblePaceFeed, parsePaceSearchParams } from "@/lib/paces-feed.server";

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 100;

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const url = new URL(request.url);
  const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit, 1), MAX_LIMIT);
  const filters = parsePaceSearchParams(url.searchParams);

  const { items } = await getVisiblePaceFeed(db, auth, request, filters);
  const paces = items.slice(offset, offset + limit);

  return Response.json({
    paces,
    total: items.length,
    hasMore: offset + paces.length < items.length,
  });
}
