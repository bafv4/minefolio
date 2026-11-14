import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useT } from "@/hooks/use-locale";

/** 見出し右のリンク。sm 未満はアイコンのみ（44px 角・ラベルは sr-only）、sm 以上は文字＋アイコン */
export function SectionHeaderLink({ to, label, prefetch }: { to: string; label: string; prefetch?: "intent" }) {
  return (
    <Button variant="ghost" size="sm" asChild className="size-11 shrink-0 sm:size-auto">
      <Link to={to} prefetch={prefetch}>
        <span className="sr-only sm:not-sr-only">{label}</span>
        <ArrowRight className="h-3.5 w-3.5 sm:ml-1" aria-hidden="true" />
      </Link>
    </Button>
  );
}

/**
 * ホームの欄の共通枠。`section` + `aria-labelledby`（h2）でランドマークにし、見出しには
 * 丸背景アイコンチップ・件数（badge）・「すべて見る」（viewAllTo）だけを置く（eyebrow は使わない）。
 * 見出し行は折り返さない（モバイルで右のリンクがアイコンのみになるのもそのため）。
 */
export function HomeSection({
  id,
  icon,
  title,
  badge,
  viewAllTo,
  action,
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
  children: ReactNode;
}) {
  const t = useT();
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="space-y-4 rounded-2xl border border-border/70 bg-card/70 p-5 sm:p-6"
    >
      <div className="flex flex-nowrap items-center gap-x-2 sm:gap-x-3">
        <div className="rounded-xl bg-primary/10 p-2">{icon}</div>
        {/* 見出しは本文との段差（1.25倍以上）を保つため text-xl のまま。モバイルは隙間を詰めて、
            アイコン＋見出し＋件数＋右のアイコンリンクを1行に収める（収まらない言語では truncate）。
            長い件数表示はモバイルで出さないよう呼び出し側で隠す（例: プロフィール欄の総数） */}
        <h2 id={headingId} className="min-w-0 truncate text-xl font-bold">
          {title}
        </h2>
        {badge && <div className="shrink-0">{badge}</div>}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {action}
          {viewAllTo && <SectionHeaderLink to={viewAllTo} label={t("home.viewAll")} />}
        </div>
      </div>
      {children}
    </section>
  );
}
