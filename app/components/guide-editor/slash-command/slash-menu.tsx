// スラッシュメニューの表示（制御コンポーネント）。
// 絞り込み・選択は renderer 側（ProseMirror keydown）が管理し、ここは描画に専念する。
// cmdk の内部状態が ProseMirror のキー操作と競合するため、素の listbox で実装する。
import { useEffect, useRef } from "react";
import type { Translator } from "@/lib/messages";
import type { SlashItem } from "../types";
import { cn } from "@/lib/utils";

export const SLASH_MENU_ID = "guide-slash-menu";

interface SlashMenuProps {
  items: SlashItem[];
  /**
   * 文言解決。このメニューはエディタ外の detached root に描画されるため
   * LocaleProvider が届かない（useT() は常に日本語になる）。呼び出し側から渡す。
   */
  t: Translator;
  selectedIndex: number;
  onSelect: (item: SlashItem) => void;
}

export function SlashMenu({ items, t, selectedIndex, onSelect }: SlashMenuProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  // 選択中の項目を可視領域へスクロール
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (items.length === 0) {
    return (
      <div className="w-64 rounded-lg border bg-popover p-3 text-sm text-muted-foreground shadow-xl">
        {t("guideEditor.slash.noResults")}
      </div>
    );
  }

  // グループ順を保持しつつ見出しを挿入するためのフラット走査
  let lastGroup: string | null = null;

  return (
    <div
      id={SLASH_MENU_ID}
      role="listbox"
      aria-label={t("guideEditor.slash.menuLabel")}
      aria-activedescendant={`${SLASH_MENU_ID}-opt-${selectedIndex}`}
      className="w-64 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl"
    >
      {items.map((item, index) => {
        const showGroup = item.group !== lastGroup;
        lastGroup = item.group;
        const Icon = item.icon;
        const selected = index === selectedIndex;
        return (
          <div key={`${item.group}-${item.title}`}>
            {showGroup && (
              <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{item.group}</p>
            )}
            <button
              ref={selected ? selectedRef : undefined}
              type="button"
              role="option"
              id={`${SLASH_MENU_ID}-opt-${index}`}
              aria-selected={selected}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              className={cn(
                "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
                selected ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              {item.title}
            </button>
          </div>
        );
      })}
    </div>
  );
}
