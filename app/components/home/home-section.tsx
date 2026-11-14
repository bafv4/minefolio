import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/**
 * ホームの欄の共通枠。`section` + `aria-labelledby`（h2）でランドマークにし、見出しには
 * 丸背景アイコンチップ・件数（badge）・「すべて見る」（viewAllTo）だけを置く（eyebrow は使わない）。
 */
export function HomeSection({
  id,
  icon,
  title,
  badge,
  viewAllTo,
  action,
  className,
  children,
}: {
  /** h2 の id 接頭辞（aria-labelledby 用。ページ内で一意） */
  id: string;
  icon: ReactNode;
  title: string;
  /** 見出し横の件数など（aria-live を付けたい場合は呼び出し側で包む） */
  badge?: ReactNode;
  viewAllTo?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn("space-y-4 rounded-2xl border border-border/70 bg-card/70 p-5 sm:p-6", className)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="rounded-xl bg-primary/10 p-2">{icon}</div>
        <h2 id={headingId} className="text-xl font-bold">
          {title}
        </h2>
        {badge}
        <div className="ml-auto flex items-center gap-2">
          {action}
          {viewAllTo && (
            <Button variant="ghost" size="sm" asChild className="min-h-11 sm:min-h-0">
              <Link to={viewAllTo}>
                {t("home.viewAll")}
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
