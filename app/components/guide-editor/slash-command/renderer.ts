// Suggestion の render() 実装。document.body にポータルを生成し、
// SlashMenu を React で描画する。選択移動・確定・キャンセルは ProseMirror keydown で制御。
// クライアント専用に発火するため SSR/hydration に影響しない（editor は immediatelyRender:false）。
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SuggestionOptions } from "@tiptap/suggestion";
import type { SlashItem } from "../types";
import type { Translator } from "@/lib/messages";
import { SlashMenu, SLASH_MENU_ID, slashOptionId } from "./slash-menu";
import { EDITOR_Z } from "../constants";

type SlashRender = NonNullable<SuggestionOptions<SlashItem>["render"]>;

/** キー入力に対するメニューの動作（純粋関数。renderer の onKeyDown とテストで共有） */
export type SlashKeyAction =
  | { type: "ignore" }
  | { type: "move"; selectedIndex: number }
  | { type: "select" }
  | { type: "dismiss" };

export function resolveSlashKey(
  event: { key: string; isComposing?: boolean; keyCode?: number },
  selectedIndex: number,
  itemCount: number,
): SlashKeyAction {
  // IME の変換中（候補選択の矢印・確定の Enter など）はメニューのキー操作として扱わない。
  // 扱うと、変換の矢印で選択が動いたり、確定の Enter で別の項目が実行されたりする
  if (event.isComposing || event.keyCode === 229) return { type: "ignore" };
  switch (event.key) {
    case "ArrowUp":
      return { type: "move", selectedIndex: itemCount ? (selectedIndex + itemCount - 1) % itemCount : selectedIndex };
    case "ArrowDown":
      return { type: "move", selectedIndex: itemCount ? (selectedIndex + 1) % itemCount : selectedIndex };
    case "Enter":
      return { type: "select" };
    case "Escape":
      return { type: "dismiss" };
    default:
      return { type: "ignore" };
  }
}

export function createSlashRenderer(getT: () => Translator): SlashRender {
  return () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;
    let selectedIndex = 0;
    let query = "";
    let dismissed = false;
    let items: SlashItem[] = [];
    let command: ((item: SlashItem) => void) | null = null;
    // フォーカスを持つエディタ本体（contenteditable、role=textbox）。メニューが開いている間だけ
    // aria-controls / aria-activedescendant を付け、選択中の項目を読み上げさせる。開閉の有無は
    // この2つの有無で伝える（aria-expanded は textbox では無効な属性なので付けない。
    // aria-haspopup="listbox" は use-guide-editor.ts の editorProps で常に付けている）
    let editorDom: HTMLElement | null = null;

    const syncEditorAria = () => {
      if (!editorDom) return;
      const open = !!root && !dismissed;
      if (open) {
        editorDom.setAttribute("aria-controls", SLASH_MENU_ID);
      } else {
        editorDom.removeAttribute("aria-controls");
      }
      if (open && items.length > 0) {
        editorDom.setAttribute("aria-activedescendant", slashOptionId(selectedIndex));
      } else {
        editorDom.removeAttribute("aria-activedescendant");
      }
    };

    const render = () => {
      syncEditorAria();
      if (!root) return;
      if (dismissed) {
        root.render(null);
        return;
      }
      root.render(
        createElement(SlashMenu, {
          items,
          t: getT(),
          selectedIndex,
          onSelect: (item: SlashItem) => command?.(item),
        }),
      );
    };

    const position = (clientRect?: (() => DOMRect | null) | null) => {
      if (!container || !clientRect) return;
      const rect = clientRect();
      if (!rect) return;
      // position:fixed はビューポート基準。clientRect もビューポート座標を返す。
      container.style.left = `${rect.left}px`;
      container.style.top = `${rect.bottom + 6}px`;
    };

    return {
      onStart: (props) => {
        selectedIndex = 0;
        query = props.query;
        dismissed = false;
        items = props.items;
        command = (item) => props.command(item);
        editorDom = props.editor.view.dom as HTMLElement;
        container = document.createElement("div");
        container.style.position = "fixed";
        container.style.zIndex = String(EDITOR_Z.slash);
        document.body.appendChild(container);
        root = createRoot(container);
        render();
        position(props.clientRect);
      },
      onUpdate: (props) => {
        items = props.items;
        command = (item) => props.command(item);
        // 絞り込みが変わったら先頭へ戻す（前の一覧での位置を持ち越すと、別の項目がハイライトされる）
        if (props.query !== query || selectedIndex >= items.length) selectedIndex = 0;
        query = props.query;
        render();
        position(props.clientRect);
      },
      onKeyDown: (props) => {
        if (dismissed) return false;
        const action = resolveSlashKey(props.event, selectedIndex, items.length);
        if (action.type === "ignore") return false;
        if (action.type === "move") {
          selectedIndex = action.selectedIndex;
          render();
          return true;
        }
        if (action.type === "select") {
          const item = items[selectedIndex];
          if (item) command?.(item);
          return true;
        }
        // メニューを閉じる（この suggestion セッション中は再表示しない）
        dismissed = true;
        render();
        return true;
      },
      onExit: () => {
        root?.unmount();
        container?.remove();
        root = null;
        container = null;
        syncEditorAria();
        editorDom = null;
      },
    };
  };
}
