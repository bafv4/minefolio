// ロケール設定API
import type { Route } from "./+types/set-locale";
import { createLocaleCookieValue, type Locale } from "@/lib/i18n";

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const locale = formData.get("locale") as string;

  // バリデーション
  if (!locale || (locale !== "ja" && locale !== "en")) {
    return new Response(JSON.stringify({ error: "Invalid locale" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Cookieを設定してリダイレクト
  const referer = request.headers.get("Referer");
  let redirectUrl = "/";

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const requestUrl = new URL(request.url);

      // 同一オリジンの場合のみリダイレクト
      if (refererUrl.origin === requestUrl.origin) {
        redirectUrl = refererUrl.pathname + refererUrl.search + refererUrl.hash;
      }
    } catch {
      redirectUrl = "/";
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl,
      "Set-Cookie": createLocaleCookieValue(locale as Locale),
    },
  });
}
