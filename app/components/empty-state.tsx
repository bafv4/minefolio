import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  /** 補足の文（省略可。無いときは <p> を描かない） */
  description?: string;
  /** 空状態からの誘導リンク・ボタン等（省略可）。例: 本人閲覧時の編集ページへの誘導 */
  action?: ReactNode;
  /** compact: sm 以上は横並び、sm 未満は縦積み（欄内の空状態用）。既定は縦積みの大きい表示 */
  size?: "default" | "compact";
  /** タイトルの要素。既定は p（見出しの段を増やさない）。ページの主題になる空状態（404 など）は h1 / h2 */
  titleAs?: "p" | "h1" | "h2";
}

export function EmptyState({ icon, title, description, action, size = "default", titleAs: Title = "p" }: EmptyStateProps) {
  if (size === "compact") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-dashed bg-card/50 px-4 py-3 text-left sm:flex-row sm:items-center text-muted-foreground">
        <div className="shrink-0 opacity-50">{icon}</div>
        <div className="min-w-0 flex-1">
          <Title className="text-sm font-medium text-foreground">{title}</Title>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0 max-sm:self-start max-sm:[&_a]:min-h-11 max-sm:[&_button]:min-h-11">{action}</div>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed bg-card/50 px-4 text-center py-12 sm:px-6 text-muted-foreground">
      <div className="mb-4 flex justify-center opacity-50">{icon}</div>
      <div className="space-y-1">
        <Title className="text-lg font-medium text-foreground">{title}</Title>
        {description && <p className="text-sm">{description}</p>}
      </div>
      {action && <div className="mt-4 max-sm:[&_a]:min-h-11 max-sm:[&_button]:min-h-11">{action}</div>}
    </div>
  );
}
