// ツールバー共通プリミティブ。desktop-toolbar / bubble-menu / mobile-toolbar で再利用。
// 旧 index.tsx の TB / Sep を切り出し、a11y（aria-label / aria-pressed）を明示する。
import type { ReactNode } from "react";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

interface ToolbarButtonProps {
  onClick: () => void;
  /** トグル状態（整形のオン/オフ）。アクション系は未指定 */
  active?: boolean;
  disabled?: boolean;
  /** ツールチップ兼アクセシブル名 */
  label: string;
  children: ReactNode;
  /** 小サイズ（h-7） */
  sm?: boolean;
  /** 展開表示時、アイコンの右にラベル文字も表示する */
  showLabel?: boolean;
}

export function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
  sm,
  showLabel,
}: ToolbarButtonProps) {
  // showLabel が指定された文脈（常設ツールバー）では、ラベルを常に描画し
  // max-width/opacity のトランジションで開閉をアニメーションする。
  const labelable = showLabel !== undefined;
  return (
    <Toggle
      size="sm"
      pressed={active ?? false}
      onPressedChange={() => onClick()}
      // mousedown でのフォーカス移動を防ぎ、選択範囲を保持する
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        labelable
          ? "h-8 justify-start px-2"
          : sm
            ? "h-7 w-7 min-w-7 px-0"
            : "h-8 w-8 min-w-8 px-0",
      )}
    >
      {children}
      {labelable && (
        <span
          className={cn(
            "overflow-hidden whitespace-nowrap text-xs transition-all duration-200",
            showLabel ? "max-w-[14ch] opacity-100 ml-1.5" : "max-w-0 opacity-0",
          )}
        >
          {label}
        </span>
      )}
    </Toggle>
  );
}

export function ToolbarSeparator() {
  return <div className="w-px h-5 bg-border mx-0.5 shrink-0" role="separator" aria-orientation="vertical" />;
}
