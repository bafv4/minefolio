import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-locale";

/**
 * /player 全体の「値なし」表記。ハイフン「-」1 種類に統一する
 * （マウス設定の MissingMouseValue と同じ表記。スクリーンリーダーには「値なし」と読ませる）。
 */
export function EmptyValue() {
  const t = useT();
  return (
    <span className="text-muted-foreground">
      <span aria-hidden>-</span>
      <span className="sr-only">{t("playerProfile.noValue")}</span>
    </span>
  );
}

/** 本人にだけ出す、空タブ向けの編集ページへの導線（EmptyState の action に渡す） */
export function OwnerEditAction({ to, label }: { to: string; label: string }) {
  return (
    <Button asChild size="sm" variant="outline" className="mt-4">
      <Link to={to}>{label}</Link>
    </Button>
  );
}
