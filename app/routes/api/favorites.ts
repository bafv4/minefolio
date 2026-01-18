import type { Route } from "./+types/favorites";
import {
  getFavoritesFromCookie,
  createFavoritesCookieValue,
  addToFavorites,
  removeFromFavorites,
} from "@/lib/favorites";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const mcid = formData.get("mcid") as string;
  const actionType = formData.get("action") as string;

  if (!mcid || !["add", "remove"].includes(actionType)) {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cookieHeader = request.headers.get("Cookie");
  const currentFavorites = getFavoritesFromCookie(cookieHeader);

  let newFavorites: string[];
  if (actionType === "add") {
    newFavorites = addToFavorites(currentFavorites, mcid);
  } else {
    newFavorites = removeFromFavorites(currentFavorites, mcid);
  }

  const cookieValue = createFavoritesCookieValue(newFavorites);

  // リファラーにリダイレクト（安全性チェック付き）
  let redirectUrl = "/";
  const referer = request.headers.get("Referer");

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const requestUrl = new URL(request.url);

      // 同一オリジンの場合のみリダイレクトを許可
      if (refererUrl.origin === requestUrl.origin) {
        redirectUrl = refererUrl.pathname + refererUrl.search + refererUrl.hash;
      }
    } catch {
      // URL解析エラーの場合は "/" にフォールバック
      redirectUrl = "/";
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl,
      "Set-Cookie": cookieValue,
    },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const cookieHeader = request.headers.get("Cookie");
  const favorites = getFavoritesFromCookie(cookieHeader);

  return Response.json({ favorites });
}
