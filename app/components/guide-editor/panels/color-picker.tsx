// 色選択の共通コンポーネント（文字色 / 背景ハイライト / テーブルのセル・行・列スタイル）。
// 旧 index.tsx の手動ドロップダウンを shadcn Popover に置き換え、a11y と外側クリック処理を委譲。
import { useT } from "@/hooks/use-locale";
import { useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { Palette, Paintbrush, AlignLeft, AlignCenter, AlignRight, X, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/messages";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { TEXT_COLORS, BG_COLORS, CELL_COLORS } from "../constants";
import { setTableCellsStyle, type TableStyleScope } from "../lib/block-commands";
import { cn } from "@/lib/utils";

type SwatchKind = "text" | "bg";

/** Popover トリガー兼ツールバーボタン（Radix の ref 転送のため素の button を使う）。
 * バブルメニュー / ツールバー / セル選択バブルで共用 */
export function PickerTrigger({
  label,
  children,
  showLabel,
  disabled,
}: {
  label: string;
  children: ReactNode;
  showLabel?: boolean;
  /** true で Popover を開けなくする（トリガーは残し、ラベルで理由を示す用途）。省略時は他利用箇所と同じ挙動 */
  disabled?: boolean;
}) {
  const labelable = showLabel !== undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "inline-flex items-center rounded-md text-foreground hover:bg-muted transition-colors disabled:pointer-events-none disabled:opacity-50",
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
  readonly nameKey: MessageKey;
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
  const t = useT();
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground px-1 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {colors.map((c) => (
          <Tooltip key={c.nameKey}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(c.value || null);
                }}
                aria-label={t(c.nameKey)}
                className="h-6 w-6 rounded border border-border flex items-center justify-center text-xs font-bold hover:ring-2 hover:ring-ring transition-all"
                style={kind === "text" ? { color: c.value || "var(--foreground)" } : { backgroundColor: c.value || "transparent" }}
              >
                {kind === "text" ? "A" : c.value ? "" : "✕"}
              </button>
            </TooltipTrigger>
            <TooltipContent showArrow={false}>{t(c.nameKey)}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

/** インライン整形用の文字色・背景色ピッカー（バブルメニュー / ツールバーで使用） */
export function InlineColorPicker({ editor, showLabel }: { editor: Editor; showLabel?: boolean }) {
  const t = useT();
  return (
    <Popover>
      <PickerTrigger label={t("guideEditor.ui.textAndBgColor")} showLabel={showLabel}>
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
          label={t("guideEditor.ui.textColor")}
          colors={TEXT_COLORS}
          kind="text"
          onPick={(v) =>
            v
              ? editor.chain().focus().setColor(v).run()
              : editor.chain().focus().unsetColor().run()
          }
        />
        <ColorSwatchGrid
          label={t("guideEditor.ui.bgColor")}
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

const TABLE_SCOPES: { key: TableStyleScope; labelKey: MessageKey }[] = [
  { key: "cell", labelKey: "guideEditor.ui.scopeCell" },
  { key: "row", labelKey: "guideEditor.ui.scopeRow" },
  { key: "column", labelKey: "guideEditor.ui.scopeColumn" },
];

const TABLE_ALIGNS = [
  { value: "left", labelKey: "guideEditor.ui.alignLeft", Icon: AlignLeft },
  { value: "center", labelKey: "guideEditor.ui.alignCenter", Icon: AlignCenter },
  { value: "right", labelKey: "guideEditor.ui.alignRight", Icon: AlignRight },
] as const satisfies ReadonlyArray<{ value: string; labelKey: MessageKey; Icon: LucideIcon }>;

/** テーブルの文字揃えボタン行（左 / 中央 / 右 / 解除）。table-handles でも使用 */
export function TableAlignRow({ onPick }: { onPick: (value: string | null) => void }) {
  const t = useT();
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground px-1 mb-1">{t("guideEditor.ui.textAlign")}</p>
      <div className="flex gap-1">
        {TABLE_ALIGNS.map(({ value, labelKey, Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t(labelKey)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(value);
                }}
                className="h-7 w-7 rounded border border-border flex items-center justify-center hover:bg-muted transition-colors"
              >
                <Icon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent showArrow={false}>{t(labelKey)}</TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("guideEditor.ui.clearAlign")}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(null);
              }}
              className="h-7 w-7 rounded border border-border flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent showArrow={false}>{t("guideEditor.ui.clearAlign")}</TooltipContent>
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
  const t = useT();
  const [scope, setScope] = useState<TableStyleScope>("cell");

  return (
    <Popover>
      <PickerTrigger label={t("guideEditor.ui.tableStyle")}>
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
          <p className="text-xs font-medium text-muted-foreground px-1 mb-1">{t("guideEditor.ui.applyScope")}</p>
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
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* 文字揃え */}
        <TableAlignRow onPick={(v) => setTableCellsStyle(editor, scope, "textAlign", v)} />

        <ColorSwatchGrid
          label={t("guideEditor.ui.bgColor")}
          colors={CELL_COLORS}
          kind="bg"
          onPick={(v) => setTableCellsStyle(editor, scope, "backgroundColor", v)}
        />
        <ColorSwatchGrid
          label={t("guideEditor.ui.textColor")}
          colors={TEXT_COLORS}
          kind="text"
          onPick={(v) => setTableCellsStyle(editor, scope, "textColor", v)}
        />
      </PopoverContent>
    </Popover>
  );
}
