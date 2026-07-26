// 表示ロケールを Cookie に保存し、元のページへ戻す。
import { isLocale, localeCookieValue } from "@/lib/locale";

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const locale = formData.get("locale");

  if (typeof locale !== "string" || !isLocale(locale)) {
    return new Response(JSON.stringify({ error: "Invalid locale" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // オープンリダイレクト対策: Referer は同一オリジンのときだけ採用し、
  // パス以降のみを使う（他サイトへ飛ばせないようにする）
  let redirectUrl = "/";
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.origin === new URL(request.url).origin) {
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
      "Set-Cookie": localeCookieValue(locale),
    },
  });
}
