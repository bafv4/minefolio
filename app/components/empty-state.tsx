import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** 空状態からの誘導リンク・ボタン等（省略可）。例: 本人閲覧時の編集ページへの誘導 */
  action?: ReactNode;
  /** compact: 1〜2行の横並び（欄内の空状態用）。既定は縦積みの大きい表示 */
  size?: "default" | "compact";
}

export function EmptyState({ icon, title, description, action, size = "default" }: EmptyStateProps) {
  if (size === "compact") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed bg-card/50 px-4 py-3 text-left text-muted-foreground">
        <div className="shrink-0 opacity-50">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed bg-card/50 text-center py-12 text-muted-foreground">
      <div className="mb-4 flex justify-center opacity-50">{icon}</div>
      <div className="space-y-1">
        <p className="text-lg font-medium text-foreground">{title}</p>
        <p className="text-sm">{description}</p>
      </div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
