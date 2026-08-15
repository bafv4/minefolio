import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import { Analytics } from "@vercel/analytics/react";

import type { Route } from "./+types/root";
import { resolveLocale, DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import { buttonVariants } from "@/components/ui/button";
import { Providers } from "@/components/providers";
import { CookieConsentBanner } from "@/components/cookie-consent";
import { BackgroundPattern } from "@/components/layout/background-pattern";
import { useT } from "@/hooks/use-locale";
import "./app.css";

/**
 * 表示ロケールを決めてツリー全体へ配る（Cookie → Accept-Language → 既定）。
 * ここで一度だけ決めることで、SSR とクライアントで同じ値になり
 * ハイドレーション不一致が起きない。
 */
export function loader({ request }: Route.LoaderArgs) {
  return { locale: resolveLocale(request) };
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
  },
];

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

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const t = useT();
  let message = t("errorPage.title");
  let details = t("errorPage.genericDetails");
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : t("errorPage.errorTitle");
    details =
      error.status === 404
        ? t("errorPage.notFoundDetails")
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <main className="flex-1 flex flex-col items-center justify-center p-4 container mx-auto">
        <div className="max-w-2xl w-full text-center space-y-6">
          <div className="space-y-2">
            <h1 className="text-6xl font-bold">{message}</h1>
            <p className="text-xl text-muted-foreground">{details}</p>
          </div>
          {stack && (
            <pre className="w-full p-4 overflow-x-auto text-left bg-secondary rounded-lg border">
              <code className="text-sm">{stack}</code>
            </pre>
          )}
          <div className="pt-4">
            <a href="/" className={buttonVariants()}>
              {t("common.backToHome")}
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
