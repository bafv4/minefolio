import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { Analytics } from "@vercel/analytics/react";

import type { Route } from "./+types/root";
import { Providers } from "@/components/providers";
import { CookieConsentBanner } from "@/components/cookie-consent";
import "./app.css";

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
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/png" href="/icon.png" />
        <Meta />
        <Links />
      </head>
      <body>
        <Providers>{children}</Providers>
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
  let message = "おっと！";
  let details = "予期しないエラーが発生しました。";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "エラー";
    details =
      error.status === 404
        ? "お探しのページが見つかりませんでした。"
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
            <a
              href="/"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4"
            >
              ホームに戻る
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
