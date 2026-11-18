import { isRouteErrorResponse, Link } from "react-router";
import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

function ErrorLink({ to, plain, className, children }: { to: string; plain: boolean; className: string; children: React.ReactNode }) {
  return plain ? (
    <a href={to} className={className}>
      {children}
    </a>
  ) : (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

/**
 * 404 の Response に loader が載せた文言（例: `throw new Response(t("playerProfile.notFound"), { status: 404 })`）を、
 * 表示に使ってよい形なら返す。使えないとき（文字列でない・長すぎる・HTML らしい・ルーターの内部の文言
 * 〔一致するルートが無いときの `Error: No route matches URL ...`〕・既定の "Not Found"）は null
 */
function notFoundMessage(error: { data: unknown; statusText: string }): string | null {
  if (typeof error.data !== "string") return null;
  const value = error.data.trim();
  if (!value || value.length > 80 || /[<>\n]/.test(value)) return null;
  if (/^Error\b/.test(value) || value === error.statusText || /^not found$/i.test(value)) return null;
  return value;
}

/**
 * ルートエラーの表示（404・その他）。`<title>` も出す（React 19 が head へ引き上げる）。
 * - 共通レイアウトの ErrorBoundary（ヘッダー・フッター付き）と root の最後の砦で共用する
 * - `plainLinks`: ルーターが壊れている可能性がある root の砦では、`Link` ではなく `<a href>` にする
 */
export function ErrorView({ error, plainLinks = false }: { error: unknown; plainLinks?: boolean }) {
  const t = useT();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  let title = t("errorPage.title");
  let details = t("errorPage.genericDetails");
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (isNotFound) {
      // loader が「走者が見つかりません」などを載せていれば見出しに使い、説明はガイドの 404 と同じ確認の案内にする
      const message = notFoundMessage(error);
      title = message ?? t("errorPage.notFoundTitle");
      details = message ? t("errorPage.notFoundHint") : t("errorPage.notFoundDetails");
    } else {
      title = t("errorPage.errorTitle");
      details = error.statusText || details;
    }
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 py-8 text-center sm:py-12">
      <title>{`${title} - Minefolio`}</title>
      <div className="space-y-2">
        {isNotFound && <p className="font-mono text-sm tabular-nums text-muted-foreground">404</p>}
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{details}</p>
      </div>
      {stack && (
        <pre className="w-full overflow-x-auto rounded-lg border bg-secondary p-4 text-left">
          <code className="text-sm">{stack}</code>
        </pre>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <ErrorLink to="/" plain={plainLinks} className={cn(buttonVariants(), "min-h-11 sm:min-h-9")}>
          {t("common.backToHome")}
        </ErrorLink>
        {isNotFound && (
          <>
            <ErrorLink to="/browse" plain={plainLinks} className={cn(buttonVariants({ variant: "outline" }), "min-h-11 sm:min-h-9")}>
              {t("nav.browse")}
            </ErrorLink>
            <ErrorLink to="/guides" plain={plainLinks} className={cn(buttonVariants({ variant: "outline" }), "min-h-11 sm:min-h-9")}>
              {t("nav.guides")}
            </ErrorLink>
          </>
        )}
      </div>
    </div>
  );
}
