import { Link } from "react-router";
import { useT } from "@/hooks/use-locale";
import { ArrowRight } from "lucide-react";

/**
 * ゲストのヒーロー左列（CTA 注記の下）に置く「ライブ N人 →」の帯。
 * モバイルではライブ欄がファーストビューの外に出るため、デスクトップでは左列の下の空きを埋めるため、「いま走っている人がいる」ことだけを先に伝えてページ内のライブ欄へ送る。
 * 人数はおかえりバーと同じ（呼び出し側が `liveSettled ? liveCount : 0` を渡す）。0人・取得前・取得失敗は何も描かない。
 */
export function LiveTeaser({ count, href }: { count: number; href: string }) {
  const t = useT();
  if (count <= 0) return null;
  return (
    <Link
      to={href}
      className="flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-card px-4 text-sm font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-fit lg:pr-5"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-live" aria-hidden="true" />
      <span className="min-w-0 truncate">{t("home.liveTeaser", { count })}</span>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
