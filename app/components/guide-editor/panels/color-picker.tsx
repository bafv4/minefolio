// 色選択の共通コンポーネント（文字色 / 背景ハイライト / テーブルセル色）。
// 旧 index.tsx の手動ドロップダウンを shadcn Popover に置き換え、a11y と外側クリック処理を委譲。
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { Palette, Paintbrush } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { TEXT_COLORS, BG_COLORS, CELL_COLORS } from "../constants";
import { setCellBackground, setCellTextColor } from "../lib/block-commands";
import { cn } from "@/lib/utils";

type SwatchKind = "text" | "bg";

/** Popover トリガー兼ツールバーボタン（Radix の ref 転送のため素の button を使う） */
function PickerTrigger({
  label,
  children,
  showLabel,
}: {
  label: string;
  children: ReactNode;
  showLabel?: boolean;
}) {
  const labelable = showLabel !== undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "inline-flex items-center rounded-md text-foreground hover:bg-muted transition-colors",
              labelable ? "h-8 justify-start px-2" : "h-7 w-7 justify-center",
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
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom" showArrow={false} className="z-[65]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

interface ColorOption {
  readonly name: string;
  readonly value: string;
}

/** ラベル付きの色スウォッチ一覧。null = 解除（✕） */
function ColorSwatchGrid({
  label,
  colors,
  kind,
  onPick,
}: {
  label: string;
  colors: readonly ColorOption[];
  kind: SwatchKind;
  onPick: (value: string | null) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground px-1 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {colors.map((c) => (
          <Tooltip key={c.name}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(c.value || null);
                }}
                aria-label={c.name}
                className="h-6 w-6 rounded border border-border flex items-center justify-center text-xs font-bold hover:ring-2 hover:ring-ring transition-all"
                style={kind === "text" ? { color: c.value || "var(--foreground)" } : { backgroundColor: c.value || "transparent" }}
              >
                {kind === "text" ? "A" : c.value ? "" : "✕"}
              </button>
            </TooltipTrigger>
            <TooltipContent showArrow={false}>{c.name}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

/** インライン整形用の文字色・背景色ピッカー（バブルメニュー / ツールバーで使用） */
export function InlineColorPicker({ editor, showLabel }: { editor: Editor; showLabel?: boolean }) {
  return (
    <Popover>
      <PickerTrigger label="文字色・背景色" showLabel={showLabel}>
        <Palette className="h-4 w-4" />
      </PickerTrigger>
      <PopoverContent
        className="w-52 p-2 space-y-2"
        onMouseDown={(e) => e.preventDefault()}
        // 開いてもフォーカスをエディタから奪わない（選択範囲を保持し、
        // バブルメニュー内で開いてもバブルが閉じてクラッシュしないようにする）
        onOpenAutoFocus={(e) => e.preventDefault()}
        align="start"
      >
        <ColorSwatchGrid
          label="文字色"
          colors={TEXT_COLORS}
          kind="text"
          onPick={(v) =>
            v
              ? editor.chain().focus().setColor(v).run()
              : editor.chain().focus().unsetColor().run()
          }
        />
        <ColorSwatchGrid
          label="背景色"
          colors={BG_COLORS}
          kind="bg"
          onPick={(v) =>
            v
              ? editor.chain().focus().toggleHighlight({ color: v }).run()
              : editor.chain().focus().unsetHighlight().run()
          }
        />
      </PopoverContent>
    </Popover>
  );
}

/** テーブルセルの背景色・文字色ピッカー（テーブル操作で使用） */
export function CellColorPicker({ editor }: { editor: Editor }) {
  return (
    <Popover>
      <PickerTrigger label="セルの色">
        <Paintbrush className="h-4 w-4" />
      </PickerTrigger>
      <PopoverContent
        className="w-52 p-2 space-y-2"
        onMouseDown={(e) => e.preventDefault()}
        // 開いてもフォーカスをエディタから奪わない（選択範囲を保持し、
        // バブルメニュー内で開いてもバブルが閉じてクラッシュしないようにする）
        onOpenAutoFocus={(e) => e.preventDefault()}
        align="start"
      >
        <ColorSwatchGrid
          label="セル背景色"
          colors={CELL_COLORS}
          kind="bg"
          onPick={(v) => setCellBackground(editor, v)}
        />
        <ColorSwatchGrid
          label="セル文字色"
          colors={TEXT_COLORS}
          kind="text"
          onPick={(v) => setCellTextColor(editor, v)}
        />
      </PopoverContent>
    </Popover>
  );
}
