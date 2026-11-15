// スラッシュメニューの表示（制御コンポーネント）。
// 絞り込み・選択は renderer 側（ProseMirror keydown）が管理し、ここは描画に専念する。
// cmdk の内部状態が ProseMirror のキー操作と競合するため、素の listbox で実装する。
import { useEffect, useRef } from "react";
import type { Translator } from "@/lib/messages";
import type { SlashItem } from "../types";
import { cn } from "@/lib/utils";

export const SLASH_MENU_ID = "guide-slash-menu";

/** 項目の id（エディタ本体の aria-activedescendant が指す。renderer.ts と共有） */
export const slashOptionId = (index: number) => `${SLASH_MENU_ID}-opt-${index}`;

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
      // 0 件でも aria-controls の参照先が残るよう、listbox と同じ id を持たせる（中身は状況の説明だけ）
      <div id={SLASH_MENU_ID} role="status" className="w-64 rounded-lg border bg-popover p-3 text-sm text-muted-foreground shadow-xl">
        {t("guideEditor.slash.noResults")}
      </div>
    );
  }

  // 連続する同じグループをまとめる（listbox の子は option か group だけにするため、見出しは group の名前にする）
  const groups: { name: string; entries: { item: SlashItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.entries.push({ item, index });
    else groups.push({ name: item.group, entries: [{ item, index }] });
  });

  // フォーカスはエディタ本体に残したまま（ProseMirror がキー操作を受ける）、選択中の項目は
  // エディタ側の aria-activedescendant で伝える（renderer.ts）
  return (
    <div
      id={SLASH_MENU_ID}
      role="listbox"
      aria-label={t("guideEditor.slash.menuLabel")}
      className="w-64 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl"
    >
      {groups.map((group, groupIndex) => {
        const headingId = `${SLASH_MENU_ID}-group-${groupIndex}`;
        return (
          <div key={`${group.name}-${groupIndex}`} role="group" aria-labelledby={headingId}>
            <p id={headingId} className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              {group.name}
            </p>
            {group.entries.map(({ item, index }) => {
              const Icon = item.icon;
              const selected = index === selectedIndex;
              const descriptionId = item.description ? `${slashOptionId(index)}-desc` : undefined;
              return (
                <button
                  key={`${item.group}-${item.title}`}
                  ref={selected ? selectedRef : undefined}
                  type="button"
                  role="option"
                  id={slashOptionId(index)}
                  aria-selected={selected}
                  aria-describedby={descriptionId}
                  tabIndex={-1}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(item);
                  }}
                  className={cn(
                    "w-full flex items-start gap-2.5 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
                    selected ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                >
                  {/* アイコンは1行目（項目名）の高さの中央に置く */}
                  <Icon className="mt-[0.1875rem] h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block">{item.title}</span>
                    {item.description && (
                      // 補足は名前に含めず aria-describedby で読む（名前は短い項目名のまま）
                      <span id={descriptionId} aria-hidden className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
