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

  // リファラーにリダイレクト
  const referer = request.headers.get("Referer") || "/";

  return new Response(null, {
    status: 302,
    headers: {
      Location: referer,
      "Set-Cookie": cookieValue,
    },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const cookieHeader = request.headers.get("Cookie");
  const favorites = getFavoritesFromCookie(cookieHeader);

  return Response.json({ favorites });
}
