import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useT } from "@/hooks/use-locale";

/** 見出し右のリンク。sm 未満はアイコンのみ（44px 角・ラベルは sr-only）、sm 以上は文字＋アイコン（size-auto で高さが文字分の 20px に縮むため min-h-8 で 32px を保つ） */
export function SectionHeaderLink({ to, label, prefetch }: { to: string; label: string; prefetch?: "intent" }) {
  return (
    <Button variant="ghost" size="sm" asChild className="size-11 shrink-0 sm:size-auto sm:min-h-8">
      <Link to={to} prefetch={prefetch}>
        <span className="sr-only sm:not-sr-only">{label}</span>
        <ArrowRight className="h-3.5 w-3.5 sm:ml-1" aria-hidden="true" />
      </Link>
    </Button>
  );
}

/**
 * ページ内の欄の共通枠（ホーム・走者画面などで共有）。`section` + `aria-labelledby`（h2）でランドマークにし、
 * 見出しにはアイコン（任意）・件数（badge）・「すべて見る」（viewAllTo）だけを置く（eyebrow は使わない）。
 * 箱なし（上罫線 `border-foreground/15` のみ）の1種類。アイコンは呼び出し側の色のまま見出しの左に置く。
 * 見出し行は折り返さない（モバイルで右のリンクがアイコンのみになるのもそのため）。
 */
export function PageSection({
  id,
  icon,
  title,
  badge,
  viewAllTo,
  action,
  headingLevel = "h2",
  first = false,
  className,
  children,
}: {
  /** h2 の id 接頭辞（aria-labelledby 用。ページ内で一意） */
  id: string;
  /** 見出しの左のアイコン。省略するとアイコン枠自体を描かない */
  icon?: ReactNode;
  title: string;
  /** 見出し横の件数など（aria-live を付けたい場合は呼び出し側で包む） */
  badge?: ReactNode;
  viewAllTo?: string;
  action?: ReactNode;
  /** 見出しのタグ。既定 h2（ホーム）。走者画面はタブタイトルが h2 なので "h3" を渡す（h3 は text-lg、h2 は text-xl） */
  headingLevel?: "h2" | "h3";
  /** true で上罫線と上余白を外す（タイトル直下の最初の欄用） */
  first?: boolean;
  /** 追加クラス（2列グリッドの1行目だけ罫線を外す `lg:border-t-0 lg:pt-0` など） */
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const headingId = `${id}-heading`;
  const Heading = headingLevel;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("scroll-mt-20 space-y-4", !first && "border-t border-foreground/15 pt-6", className)}
    >
      <div className={cn("flex items-center gap-x-2 sm:gap-x-3", "flex-nowrap")}>
        {icon && <div className="shrink-0">{icon}</div>}
        {/* 見出しは本文との段差（1.25倍以上）を保つため text-xl のまま。モバイルは隙間を詰めて、
            アイコン＋見出し＋件数＋右のアイコンリンクを1行に収める（収まらない言語では truncate）。
            長い件数表示はモバイルで出さないよう呼び出し側で隠す（例: プロフィール欄の総数） */}
        <Heading id={headingId} tabIndex={-1} className={cn("min-w-0 truncate font-bold", headingLevel === "h3" ? "text-lg" : "text-xl")}>
          {title}
        </Heading>
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
