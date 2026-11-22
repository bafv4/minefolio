import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import { Analytics } from "@vercel/analytics/react";

import type { Route } from "./+types/root";
import { CONTRAST_INIT_SCRIPT } from "@/lib/contrast";
import { resolveLocale, DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { loadLocaleMessages } from "@/lib/messages";
import { ErrorView } from "@/components/layout/error-view";
import { Providers } from "@/components/providers";
import { CookieConsentBanner } from "@/components/cookie-consent";
import { BackgroundPattern } from "@/components/layout/background-pattern";
import "./app.css";

/**
 * 表示ロケールを決めてツリー全体へ配る（Cookie → Accept-Language → 既定）。
 * ここで一度だけ決めることで、SSR とクライアントで同じ値になり
 * ハイドレーション不一致が起きない。
 */
export function loader({ request }: Route.LoaderArgs) {
  return { locale: resolveLocale(request) };
}

/**
 * 遷移・送信のたびに root ローダーが再実行され、別タブで言語を切り替えた後などに
 * ロケールが変わりうる。英語カタログが未読み込みのまま描画しないよう、描画前に読み込む。
 * 初回（ハイドレーション）は app/entry.client.tsx が担うので `hydrate` は付けない。
 */
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  const data = await serverLoader();
  await loadLocaleMessages(data.locale).catch(() => undefined);
  return data;
}

export function Layout({ children }: { children: React.ReactNode }) {
  // Layout はエラー時にも描画され、その場合 root ローダーのデータが無い。
  // useLoaderData だと例外になるため useRouteLoaderData で取り、既定へ落とす。
  const data = useRouteLoaderData<typeof loader>("root");
  const locale: Locale = data?.locale ?? DEFAULT_LOCALE;

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/png" href="/icon.png" />
        {/* ハイコントラストの属性を描画前に付ける（ちらつき防止）。判定は @/lib/contrast の resolveContrast と同じ */}
        <script dangerouslySetInnerHTML={{ __html: CONTRAST_INIT_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        <BackgroundPattern />
        <Providers locale={locale}>{children}</Providers>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      <Outlet />
      <CookieConsentBanner />
      <Analytics />
    </>
  );
}

// 最後の砦。共通レイアウト（routes/_layout.tsx の ErrorBoundary）が受けられない
// root / _layout 自身の loader の失敗で使う。ルーターが壊れている可能性があるので `<a href>` を使う。
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <main className="flex-1 flex flex-col items-center justify-center p-4 container mx-auto">
        <ErrorView error={error} plainLinks />
      </main>
    </div>
  );
}
