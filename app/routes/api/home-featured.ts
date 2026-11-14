// ホームの「注目の走者」の「別の走者」用API。キー配置・感度・メインカテゴリが揃った公開プロフィールから
// ランダムに1人を返す（表示中・直前の slug は exclude で除外）。結果は毎回変わるためキャッシュしない。

import type { Route } from "./+types/home-featured";
import { createDb } from "@/lib/db";
import { getRandomFeaturedRunner } from "@/lib/home-featured.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const exclude = (url.searchParams.get("exclude") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 100)
    .slice(0, 5);
  const runner = await getRandomFeaturedRunner(createDb(), exclude);
  return Response.json({ runner }, { headers: { "Cache-Control": "no-store" } });
}
