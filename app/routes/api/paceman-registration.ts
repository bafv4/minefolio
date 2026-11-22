// PaceMan 登録確認API（プロフィールページ用）
// paceman.gg のレスポンスには CORS ヘッダーが無くブラウザから直接呼べないため、サーバー経由で確認する。
// 上流のホストは固定で、受け取るのは Minecraft の名前（MCID）だけ（任意ホストへのプロキシにしない）。

import type { LoaderFunctionArgs } from "react-router";
import { checkPaceManPlayer } from "@/lib/external-stats";
import { MCID_SHAPE } from "@/lib/mojang";

// ブラウザキャッシュ（秒）: 同じ走者を開き直すたびに CDN へ問い合わせないため
const BROWSER_MAX_AGE = 5 * 60;
// CDNキャッシュ（秒）: 登録状況は頻繁に変わらないため数時間。失敗（502）はキャッシュしない
const CDN_MAX_AGE = 3 * 60 * 60;
const CDN_SWR = 24 * 60 * 60;

export async function loader({ request }: LoaderFunctionArgs) {
  const name = new URL(request.url).searchParams.get("name");
  if (!name || !MCID_SHAPE.test(name)) {
    return Response.json({ error: "Invalid name" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const { isRegistered } = await checkPaceManPlayer(name);
    return Response.json(
      { isRegistered },
      { headers: { "Cache-Control": `public, max-age=${BROWSER_MAX_AGE}, s-maxage=${CDN_MAX_AGE}, stale-while-revalidate=${CDN_SWR}` } },
    );
  } catch {
    return Response.json({ error: "Upstream unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
