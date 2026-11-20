import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-locale";

/**
 * /me 配下の ErrorBoundary 共通部品。
 * /me レイアウトが container を持つので、ここでは重ねない。
 * 失敗の面は ui.md 8 章（`border-destructive/30 bg-destructive/10`、role=status）。
 */
export function MeErrorBoundary() {
  const t = useT();
  return (
    <div
      role="status"
      className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center space-y-4"
    >
      <AlertCircle className="h-12 w-12 mx-auto text-destructive" aria-hidden />
      <h2 className="text-2xl font-bold">{t("meErrorBoundary.title")}</h2>
      <p className="text-muted-foreground">{t("meErrorBoundary.description")}</p>
      <Button onClick={() => window.location.reload()}>{t("meErrorBoundary.reload")}</Button>
    </div>
  );
}
