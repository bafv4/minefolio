// 色選択の共通コンポーネント（文字色 / 背景ハイライト / テーブルのセル・行・列スタイル）。
// 旧 index.tsx の手動ドロップダウンを shadcn Popover に置き換え、a11y と外側クリック処理を委譲。
import { useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { Palette, Paintbrush, AlignLeft, AlignCenter, AlignRight, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { TEXT_COLORS, BG_COLORS, CELL_COLORS } from "../constants";
import { setTableCellsStyle, type TableStyleScope } from "../lib/block-commands";
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

/** ラベル付きの色スウォッチ一覧。null = 解除（✕）。table-handles でも使用 */
export function ColorSwatchGrid({
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

const TABLE_SCOPES: { key: TableStyleScope; label: string }[] = [
  { key: "cell", label: "セル" },
  { key: "row", label: "行" },
  { key: "column", label: "列" },
];

const TABLE_ALIGNS = [
  { value: "left", label: "左揃え", Icon: AlignLeft },
  { value: "center", label: "中央揃え", Icon: AlignCenter },
  { value: "right", label: "右揃え", Icon: AlignRight },
] as const;

/** テーブルの文字揃えボタン行（左 / 中央 / 右 / 解除）。table-handles でも使用 */
export function TableAlignRow({ onPick }: { onPick: (value: string | null) => void }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground px-1 mb-1">文字揃え</p>
      <div className="flex gap-1">
        {TABLE_ALIGNS.map(({ value, label, Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(value);
                }}
                className="h-7 w-7 rounded border border-border flex items-center justify-center hover:bg-muted transition-colors"
              >
                <Icon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent showArrow={false}>{label}</TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="揃えを解除"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(null);
              }}
              className="h-7 w-7 rounded border border-border flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent showArrow={false}>揃えを解除</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * テーブルのスタイル指定ピッカー（テーブル操作で使用）。
 * 適用範囲（セル / 行 / 列）を選び、背景色・文字色・文字揃えを一括適用する。
 */
export function TableStylePicker({ editor }: { editor: Editor }) {
  const [scope, setScope] = useState<TableStyleScope>("cell");

  return (
    <Popover>
      <PickerTrigger label="テーブルのスタイル">
        <Paintbrush className="h-4 w-4" />
      </PickerTrigger>
      <PopoverContent
        className="w-56 p-2 space-y-2"
        onMouseDown={(e) => e.preventDefault()}
        // 開いてもフォーカスをエディタから奪わない（選択範囲を保持する）
        onOpenAutoFocus={(e) => e.preventDefault()}
        align="start"
      >
        {/* 適用範囲 */}
        <div>
          <p className="text-xs font-medium text-muted-foreground px-1 mb-1">適用範囲</p>
          <div className="flex gap-1">
            {TABLE_SCOPES.map((s) => (
              <button
                key={s.key}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setScope(s.key);
                }}
                className={cn(
                  "flex-1 h-7 rounded text-xs transition-colors",
                  scope === s.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 文字揃え */}
        <TableAlignRow onPick={(v) => setTableCellsStyle(editor, scope, "textAlign", v)} />

        <ColorSwatchGrid
          label="背景色"
          colors={CELL_COLORS}
          kind="bg"
          onPick={(v) => setTableCellsStyle(editor, scope, "backgroundColor", v)}
        />
        <ColorSwatchGrid
          label="文字色"
          colors={TEXT_COLORS}
          kind="text"
          onPick={(v) => setTableCellsStyle(editor, scope, "textColor", v)}
        />
      </PopoverContent>
    </Popover>
  );
}
