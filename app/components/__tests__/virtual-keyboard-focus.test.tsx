// @vitest-environment jsdom
// VirtualKeyboard / VirtualMouse / VirtualNumpad の roving tabindex のテスト。
// 1インスタンスにつき Tab 停止点（tabindex="0"）は1つ、フォーカスできるキーが無ければ0。
// 読み取り専用で情報の無いキーは button ではなく aria-hidden の div で描く。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { VirtualKeyboard, VirtualMouse, VirtualNumpad, keybindingsToMap } from "../virtual-keyboard";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mount: HTMLElement;

beforeEach(() => {
  // デスクトップ幅（max-width: 767px にマッチしない）として扱う
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
  // フォーカスでツールチップが開く（Radix の popper が ResizeObserver を使う）
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(element: ReactElement) {
  await act(async () => root.render(element));
}

const countTabStops = (el: ParentNode) => el.querySelectorAll('[tabindex="0"]').length;

const threeBindings = keybindingsToMap([
  { action: "forward", keyCode: "KeyW", category: "movement" },
  { action: "inventory", keyCode: "KeyE", category: "inventory" },
  { action: "jump", keyCode: "Space", category: "movement" },
]);

describe("VirtualKeyboard の Tab 停止点", () => {
  it("読み取り専用で割り当て3個: フォーカスできるキーは3個、Tab 停止点は1つ", async () => {
    await render(createElement(VirtualKeyboard, { keybindings: threeBindings, hideNumpad: true }));
    expect(mount.querySelectorAll("button").length).toBe(3);
    expect(countTabStops(mount)).toBe(1);
    const group = mount.querySelector('[role="group"]')!;
    expect(group.getAttribute("aria-label")).toBe("キーボード（US）");
    expect(group.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("編集（onKeyClick あり）: 全キーが button、Tab 停止点は1つ", async () => {
    await render(
      createElement(VirtualKeyboard, { keybindings: threeBindings, onKeyClick: () => {}, hideNumpad: true }),
    );
    expect(mount.querySelectorAll("button").length).toBeGreaterThan(60);
    expect(countTabStops(mount)).toBe(1);
  });

  it("情報なし: button も Tab 停止点も持たない（キーは aria-hidden の div）", async () => {
    await render(createElement(VirtualKeyboard, { layout: "JIS", hideNumpad: true }));
    expect(mount.querySelectorAll("button").length).toBe(0);
    expect(countTabStops(mount)).toBe(0);
    expect(mount.querySelector('[role="group"]')!.getAttribute("aria-describedby")).toBeNull();
  });

  it("フォーカスしたキーが Tab 停止点になる", async () => {
    await render(createElement(VirtualKeyboard, { keybindings: threeBindings, hideNumpad: true }));
    const buttons = Array.from(mount.querySelectorAll("button"));
    expect(buttons[0].tabIndex).toBe(0);
    await act(async () => buttons[2].focus());
    expect(buttons[2].tabIndex).toBe(0);
    expect(buttons[0].tabIndex).toBe(-1);
    expect(countTabStops(mount)).toBe(1);
  });

  it("現在のキーが消えたら最初のフォーカスできるキーに戻る", async () => {
    await render(createElement(VirtualKeyboard, { keybindings: threeBindings, hideNumpad: true }));
    const buttons = Array.from(mount.querySelectorAll("button"));
    await act(async () => buttons[2].focus()); // Space
    const withoutSpace = keybindingsToMap([
      { action: "forward", keyCode: "KeyW", category: "movement" },
      { action: "inventory", keyCode: "KeyE", category: "inventory" },
    ]);
    await render(createElement(VirtualKeyboard, { keybindings: withoutSpace, hideNumpad: true }));
    const after = Array.from(mount.querySelectorAll("button"));
    expect(after.length).toBe(2);
    expect(countTabStops(mount)).toBe(1);
    expect(after[0].tabIndex).toBe(0);
  });

  it("section ごとに1インスタンスとして Tab 停止点を1つずつ持つ", async () => {
    const withNav = keybindingsToMap([
      { action: "forward", keyCode: "KeyW", category: "movement" },
      { action: "drop", keyCode: "Delete", category: "inventory" },
    ]);
    await render(
      createElement("div", null,
        createElement(VirtualKeyboard, { keybindings: withNav, section: "main", hideNumpad: true }),
        createElement(VirtualKeyboard, { keybindings: withNav, section: "nav" }),
      ),
    );
    const groups = mount.querySelectorAll('[role="group"]');
    expect(groups.length).toBe(2);
    expect(countTabStops(groups[0])).toBe(1);
    expect(countTabStops(groups[1])).toBe(1);
    expect(groups[1].getAttribute("aria-label")).toBe("キーボード（ナビゲーションキー）");
  });

  it("矢印キーで位置に沿ってフォーカスが移る（修飾キー併用は無視）", async () => {
    // jsdom はレイアウトを持たないので、キーの矩形を id ごとに与える
    const rects: Record<string, [number, number]> = {
      "key:KeyW": [124, 124],
      "key:KeyE": [186, 124],
      "key:Space": [248, 310],
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const [left, top] = rects[this.getAttribute("data-roving-key") ?? ""] ?? [0, 0];
      return { left, top, width: 60, height: 60, right: left + 60, bottom: top + 60, x: left, y: top, toJSON: () => ({}) } as DOMRect;
    });
    await render(createElement(VirtualKeyboard, { keybindings: threeBindings, hideNumpad: true }));
    const byId = (id: string) => mount.querySelector<HTMLElement>(`[data-roving-key="${id}"]`)!;
    const press = async (el: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
      await act(async () => {
        el.dispatchEvent(event);
      });
      return event;
    };
    await act(async () => byId("key:KeyW").focus());
    const right = await press(byId("key:KeyW"), "ArrowRight");
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId("key:KeyE"));
    await press(byId("key:KeyE"), "ArrowDown");
    expect(document.activeElement).toBe(byId("key:Space"));
    expect(byId("key:Space").tabIndex).toBe(0);
    // 行き先なし: 何もしない（preventDefault もしない）
    const none = await press(byId("key:Space"), "ArrowDown");
    expect(none.defaultPrevented).toBe(false);
    // 修飾キー併用は素通し
    const shifted = await press(byId("key:Space"), "ArrowUp", { shiftKey: true });
    expect(shifted.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(byId("key:Space"));
  });

  it("SSR の HTML でも Tab 停止点はちょうど1つ", () => {
    const html = renderToString(
      createElement(VirtualKeyboard, { keybindings: threeBindings, hideNumpad: true }),
    );
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
  });
});

describe("VirtualMouse / VirtualNumpad の Tab 停止点", () => {
  it("マウス: 読み取り専用で情報のあるボタンとカスタムボタンだけがフォーカスでき、Tab 停止点は1つ", async () => {
    const mouseBindings = keybindingsToMap([{ action: "attack", keyCode: "Mouse0", category: "combat" }]);
    await render(
      createElement(VirtualMouse, {
        keybindings: mouseBindings,
        customButtons: [{ code: "Mouse5", label: "DPI", category: "mouse" }],
      }),
    );
    expect(mount.querySelectorAll("button").length).toBe(2);
    expect(countTabStops(mount)).toBe(1);
  });

  it("テンキー: 情報なしなら Tab 停止点を持たない、編集なら1つ", async () => {
    await render(createElement(VirtualNumpad, {}));
    expect(mount.querySelectorAll("button").length).toBe(0);
    expect(countTabStops(mount)).toBe(0);
    await render(createElement(VirtualNumpad, { onKeyClick: () => {} }));
    expect(mount.querySelectorAll("button").length).toBe(17);
    expect(countTabStops(mount)).toBe(1);
  });
});
