// セル選択（CellSelection）時のバブルメニュー。文字列選択のバブルメニューと同じ見た目で、
// 内容はテーブル編集（結合 / 分割・文字揃え・背景色 / 文字色・テーブルコピー）に置き換える。
// 行・列ハンドルのメニューが開いている間は重ならないよう抑制する（table-ui-state 参照）。
import { useT } from "@/hooks/use-locale";
import { useCallback, useEffect, useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { toast } from "sonner";
import { Popover, PopoverContent } from "@/components/ui/popover";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Copy,
  Paintbrush,
  TableCellsMerge,
  X,
} from "lucide-react";
import { ToolbarButton, ToolbarSeparator } from "./toolbar-button";
import { ColorSwatchGrid, PickerTrigger } from "../panels/color-picker";
import {
  applyTableOp,
  setTableCellsStyle,
  copyTableToClipboard,
  type TableCellStyleAttr,
} from "../lib/block-commands";
import { isTableHandleMenuOpen } from "../lib/table-ui-state";
import { useEditorRerender } from "../hooks/use-editor-rerender";
import { CELL_COLORS, TEXT_COLORS, EDITOR_Z } from "../constants";

// 参照を安定させ、BubbleMenu のプラグイン再登録ループを防ぐ（bubble-menu.tsx と同じ理由）
const BUBBLE_OPTIONS = { placement: "top" } as const;

const ALIGNS = [
  { value: "left", labelKey: "guideEditor.ui.alignLeft", Icon: AlignLeft },
  { value: "center", labelKey: "guideEditor.ui.alignCenter", Icon: AlignCenter },
  { value: "right", labelKey: "guideEditor.ui.alignRight", Icon: AlignRight },
] as const;

/** 選択中セルへの背景色・文字色ピッカー（CellSelection を保持したまま適用する）。
 * バブルが消えるときに親が閉じられるよう controlled にする（BubbleMenu の hide は
 * DOM remove のみで、ポータルされた PopoverContent が孤児として残るのを防ぐ） */
function CellColorPicker({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const apply = (attr: TableCellStyleAttr) => (value: string | null) =>
    setTableCellsStyle(editor, "cell", attr, value);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PickerTrigger label={t("guideEditor.ui.cellColors")}>
        <Paintbrush className="h-4 w-4" />
      </PickerTrigger>
      <PopoverContent
        className="w-52 p-2 space-y-2"
        onMouseDown={(e) => e.preventDefault()}
        // 開閉でフォーカスをエディタから奪わない（CellSelection を保持する）
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        align="start"
      >
        <ColorSwatchGrid label={t("guideEditor.ui.bgColor")} colors={CELL_COLORS} kind="bg" onPick={apply("backgroundColor")} />
        <ColorSwatchGrid label={t("guideEditor.ui.textColor")} colors={TEXT_COLORS} kind="text" onPick={apply("textColor")} />
      </PopoverContent>
    </Popover>
  );
}

interface TableCellBubbleMenuProps {
  editor: Editor;
  /** false でバブルを無効化（タッチはツールバー「テーブル」タブで操作） */
  enabled?: boolean;
}

export function TableCellBubbleMenu({ editor, enabled = true }: TableCellBubbleMenuProps) {
  const t = useT();
  useEditorRerender(editor);
  const [pickerOpen, setPickerOpen] = useState(false);

  const shouldShow = useCallback(() => {
    if (!enabled) return false;
    // セル跨ぎの CellSelection のみ対象（通常のテキスト選択は文字整形バブルが担当）
    if (!(editor.state.selection instanceof CellSelection)) return false;
    // 行・列ハンドルのメニュー表示中は重ねない
    if (isTableHandleMenuOpen(editor)) return false;
    return true;
  }, [editor, enabled]);

  // バブルの表示条件が崩れたら、開いたままのカラーピッカーも道連れに閉じる
  // （useEditorRerender によりトランザクションごとに再評価される）
  const bubbleVisible =
    enabled &&
    editor.state.selection instanceof CellSelection &&
    !isTableHandleMenuOpen(editor);
  useEffect(() => {
    if (!bubbleVisible && pickerOpen) setPickerOpen(false);
  }, [bubbleVisible, pickerOpen]);

  const handleCopyTable = useCallback(() => {
    void copyTableToClipboard(editor).then((ok) => {
      if (ok) toast.success(t("guideEditor.ui.tableCopied"));
      else toast.error(t("guideEditor.ui.tableCopyFailed"));
    });
  }, [editor, t]);

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={shouldShow}
      options={BUBBLE_OPTIONS}
      role="toolbar"
      aria-label={t("guideEditor.ui.editTable")}
      className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-xl"
      style={{ zIndex: EDITOR_Z.bubble }}
    >
      <ToolbarButton
        sm
        label={t("guideEditor.toolbar.mergeOrSplit")}
        onClick={() => applyTableOp(editor, "mergeOrSplit")}
      >
        <TableCellsMerge className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      {ALIGNS.map(({ value, labelKey, Icon }) => (
        <ToolbarButton
          key={value}
          sm
          label={t(labelKey)}
          onClick={() => setTableCellsStyle(editor, "cell", "textAlign", value)}
        >
          <Icon className="h-4 w-4" />
        </ToolbarButton>
      ))}
      <ToolbarButton
        sm
        label={t("guideEditor.ui.clearAlign")}
        onClick={() => setTableCellsStyle(editor, "cell", "textAlign", null)}
      >
        <X className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <CellColorPicker editor={editor} open={pickerOpen} onOpenChange={setPickerOpen} />

      <ToolbarSeparator />

      <ToolbarButton sm label={t("guideEditor.ui.copyTable")} onClick={handleCopyTable}>
        <Copy className="h-4 w-4" />
      </ToolbarButton>
    </BubbleMenu>
  );
}
