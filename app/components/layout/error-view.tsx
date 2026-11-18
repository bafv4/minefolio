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
      title = t("errorPage.notFoundTitle");
      details = t("errorPage.notFoundDetails");
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
