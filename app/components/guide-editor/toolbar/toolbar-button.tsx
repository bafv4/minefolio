// ツールバー共通プリミティブ。desktop-toolbar / bubble-menu / mobile-toolbar で再利用。
// shadcn Tooltip でリッチなツールチップ（ラベル + ショートカット）を表示する。
import type { ReactNode } from "react";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ToolbarButtonProps {
  onClick: () => void;
  /** トグル状態（整形のオン/オフ）。アクション系は未指定 */
  active?: boolean;
  disabled?: boolean;
  /** ツールチップ兼アクセシブル名 */
  label: string;
  /** ツールチップに表示するキーボードショートカット（例: "Ctrl B"） */
  shortcut?: string;
  /** ツールチップだけに出す補足（アクセシブル名には含めない。例: 表の挿入でサーチ文字列は埋め込みを勧める） */
  description?: string;
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
  shortcut,
  description,
  children,
  sm,
  showLabel,
}: ToolbarButtonProps) {
  // showLabel が指定された文脈（常設ツールバー）では、ラベルを常に描画し
  // max-width/opacity のトランジションで開閉をアニメーションする。
  const labelable = showLabel !== undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={active ?? false}
          onPressedChange={() => onClick()}
          // mousedown でのフォーカス移動を防ぎ、選択範囲を保持する
          onMouseDown={(e) => e.preventDefault()}
          disabled={disabled}
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
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        showArrow={false}
        className={cn("z-[65]", description ? "max-w-72 space-y-0.5" : "flex items-center gap-2")}
      >
        <span className={cn(description ? "flex items-center gap-2 font-medium" : "contents")}>
          <span>{label}</span>
          {shortcut && (
            <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {shortcut}
            </kbd>
          )}
        </span>
        {description && <span className="block text-muted-foreground">{description}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

export function ToolbarSeparator() {
  return <div className="w-px h-5 bg-border mx-0.5 shrink-0" role="separator" aria-orientation="vertical" />;
}
