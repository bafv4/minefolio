import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** 空状態からの誘導リンク・ボタン等（省略可）。例: 本人閲覧時の編集ページへの誘導 */
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed bg-card/50 text-center py-12 text-muted-foreground">
      <div className="mb-4 flex justify-center opacity-50">{icon}</div>
      <p className="text-lg font-medium">{title}</p>
      <p className="text-sm">{description}</p>
      {action}
    </div>
  );
}
