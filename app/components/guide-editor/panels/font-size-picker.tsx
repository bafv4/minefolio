// 文字サイズ（段階指定）のピッカー。ツールバー / モバイルツールバー / バブルメニューで共用する。
// 構造は色ピッカー（color-picker.tsx）に合わせ、PickerTrigger + Popover を再利用する。
import type { Editor } from "@tiptap/core";
import { AArrowUp } from "lucide-react";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { PickerTrigger } from "./color-picker";
import { FONT_SIZES } from "../constants";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";

/** 現在の選択に適用されている段階（未設定なら空文字＝標準） */
function currentFontSize(editor: Editor): string {
  const value = editor.getAttributes("textStyle").fontSize;
  return typeof value === "string" ? value : "";
}

// 見出し（h1〜h3）は app.css で 1.15〜1.875em の固定サイズを持っており、
// そこへ span の font-size を重ねると見出し階層の一貫性が壊れる。
// そのため見出し内では文字サイズ変更そのものを禁止する。
// Editor を丸ごと要求せず isActive だけを Pick するのは、コンポーネントテストを
// 経由せず（block-commands.test.ts と同様に）実 Editor インスタンスで直接検証できるようにするため。
/** 現在の選択が文字サイズ変更を許可される位置か（見出し内なら false） */
export function isFontSizeEditable(editor: Pick<Editor, "isActive">): boolean {
  return !editor.isActive("heading");
}

/**
 * ガードつきで文字サイズを適用する。見出し内では何もしない
 * （UI 側で PickerTrigger を disabled にしていても、既に選択済みの範囲を
 * 見出しへ変換した直後など、コマンドが直接叩かれ得る経路の保険）。
 */
export function applyGuideFontSize(editor: Editor, value: string): void {
  if (!isFontSizeEditable(editor)) return;
  // 「標準」は属性を消す（空の textStyle も除去される）
  if (value) editor.chain().focus().setFontSize(value).run();
  else editor.chain().focus().unsetFontSize().run();
}

export function FontSizePicker({
  editor,
  showLabel,
}: {
  editor: Editor;
  showLabel?: boolean;
}) {
  const t = useT();
  const current = currentFontSize(editor);
  const editable = isFontSizeEditable(editor);

  return (
    <Popover>
      <PickerTrigger
        label={editable ? t("guideEditor.fontSize") : t("guideEditor.fontSizeDisabledInHeading")}
        showLabel={showLabel}
        disabled={!editable}
      >
        <AArrowUp className="h-4 w-4" />
      </PickerTrigger>
      <PopoverContent
        className="w-40 p-1"
        onMouseDown={(e) => e.preventDefault()}
        // 開いてもフォーカスをエディタから奪わない（選択範囲を保持する）
        onOpenAutoFocus={(e) => e.preventDefault()}
        align="start"
      >
        {FONT_SIZES.map((size) => {
          const isActive = current === size.value;
          return (
            <button
              key={size.name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                applyGuideFontSize(editor, size.value);
              }}
              aria-pressed={isActive}
              className={cn(
                "flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left transition-colors",
                isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {/* プレビュー: 実際の段階の大きさで「あA」を表示する */}
              <span
                className="w-10 shrink-0 text-center leading-none"
                style={{ fontSize: size.value || "1em" }}
              >
                あA
              </span>
              <span className="text-xs">{size.name}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
