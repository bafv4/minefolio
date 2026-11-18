import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { findNextKeyInGrid, keyGridDirectionForKey, type KeyGridItem } from "@/lib/key-grid-navigation";

const KEY_ATTR = "data-roving-key";

/** フォーカスできるキーの要素に広げる props */
export type RovingItemProps = {
  "data-roving-key": string;
  tabIndex: 0 | -1;
  onFocus: () => void;
};

/**
 * 仮想キーボード（VirtualKeyboard / VirtualMouse / VirtualNumpad）の roving tabindex。
 * 1インスタンスにつき Tab 停止点は「現在のキー」1つだけにし、矢印キー・Home / End で
 * 位置（getBoundingClientRect）に沿ってキー間を移動する。
 *
 * 使い方: 描画のたびに、フォーカスできるキーを DOM 順で `getItemProps(id)` に通し、戻り値を
 * キーの要素（button）に広げる。ルートの要素に `rootRef` と `onKeyDown` を付ける。
 *
 * - 現在のキーは最後にフォーカスしたキー。初期値（SSR の HTML を含む）は DOM 順で最初のキー
 * - 現在のキーが描画から消えたら、描画前（layout effect）に最初のキーへ戻す
 * - フォーカスできるキーが0個なら Tab 停止点を持たない
 */
export function useRovingKeyFocus<T extends HTMLElement = HTMLDivElement>() {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const rootRef = useRef<T>(null);

  // この描画で登録されたキー（DOM 順）。描画ごとに作り直す
  const ids: string[] = [];

  const getItemProps = (id: string): RovingItemProps => {
    const isCurrent = currentId === null ? ids.length === 0 : id === currentId;
    ids.push(id);
    return {
      [KEY_ATTR]: id,
      tabIndex: isCurrent ? 0 : -1,
      onFocus: () => setCurrentId(id),
    };
  };

  // 描画が終わった時点の ids（このクロージャは同じ描画の配列を見る）に現在のキーが無ければ、
  // 描画前に最初のキーへ戻す（配列・プリセット・section・リマップの変更でキーが消えたとき）
  useLayoutEffect(() => {
    if (currentId !== null && !ids.includes(currentId)) {
      setCurrentId(null);
    }
  });

  const onKeyDown = useCallback((event: KeyboardEvent<T>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const direction = keyGridDirectionForKey(event.key);
    if (!direction) return;
    const root = rootRef.current;
    const target = event.target;
    // React のイベントはポータル（モバイルの情報ダイアログ等）を越えて上がってくるので、
    // このルートの DOM 内のキーから来たものだけを扱う
    if (!root || !(target instanceof HTMLElement)) return;
    const currentEl = target.closest<HTMLElement>(`[${KEY_ATTR}]`);
    if (!currentEl || !root.contains(currentEl)) return;
    const elements = Array.from(root.querySelectorAll<HTMLElement>(`[${KEY_ATTR}]`));
    const items: KeyGridItem[] = elements.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute(KEY_ATTR) ?? "",
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      };
    });
    const nextId = findNextKeyInGrid(items, currentEl.getAttribute(KEY_ATTR) ?? "", direction);
    if (!nextId) return;
    const nextEl = elements.find((el) => el.getAttribute(KEY_ATTR) === nextId);
    if (!nextEl) return;
    event.preventDefault();
    nextEl.focus({ preventScroll: true });
    nextEl.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, []);

  return { rootRef, getItemProps, onKeyDown, focusableCount: () => ids.length };
}
