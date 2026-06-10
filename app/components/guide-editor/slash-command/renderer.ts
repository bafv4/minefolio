// Suggestion の render() 実装。document.body にポータルを生成し、
// SlashMenu を React で描画する。選択移動・確定・キャンセルは ProseMirror keydown で制御。
// クライアント専用に発火するため SSR/hydration に影響しない（editor は immediatelyRender:false）。
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SuggestionOptions } from "@tiptap/suggestion";
import type { SlashItem } from "../types";
import { SlashMenu } from "./slash-menu";
import { EDITOR_Z } from "../constants";

type SlashRender = NonNullable<SuggestionOptions<SlashItem>["render"]>;

export function createSlashRenderer(): SlashRender {
  return () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;
    let selectedIndex = 0;
    let dismissed = false;
    let items: SlashItem[] = [];
    let command: ((item: SlashItem) => void) | null = null;

    const render = () => {
      if (!root) return;
      if (dismissed) {
        root.render(null);
        return;
      }
      root.render(
        createElement(SlashMenu, {
          items,
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
        dismissed = false;
        items = props.items;
        command = (item) => props.command(item);
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
        if (selectedIndex >= items.length) selectedIndex = 0;
        render();
        position(props.clientRect);
      },
      onKeyDown: (props) => {
        const { key } = props.event;
        if (dismissed) return false;
        if (key === "ArrowUp") {
          if (items.length) selectedIndex = (selectedIndex + items.length - 1) % items.length;
          render();
          return true;
        }
        if (key === "ArrowDown") {
          if (items.length) selectedIndex = (selectedIndex + 1) % items.length;
          render();
          return true;
        }
        if (key === "Enter") {
          const item = items[selectedIndex];
          if (item) command?.(item);
          return true;
        }
        if (key === "Escape") {
          // メニューを閉じる（この suggestion セッション中は再表示しない）
          dismissed = true;
          render();
          return true;
        }
        return false;
      },
      onExit: () => {
        root?.unmount();
        container?.remove();
        root = null;
        container = null;
      },
    };
  };
}
