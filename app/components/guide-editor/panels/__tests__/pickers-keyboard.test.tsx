// @vitest-environment jsdom
// 色・文字サイズのパネルをキーボードで使えることの回帰テスト。
// - 適用は click（Enter / Space が生む）で行われ、mousedown だけでは適用されない
// - キーボードで開いたら、選択中（無ければ先頭）の項目へフォーカスが入る。マウスで開いたときは入らない
// - 選択中の項目に aria-pressed が付き、矢印キーで項目間を移動できる（Tab の停止点は 1 つ）
// jsdom は Enter → click の合成をしないので、click を直接発火して「onClick で適用される」ことを確かめる。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../../editor-config";
import { InlineColorPicker } from "../color-picker";
import { FontSizePicker } from "../font-size-picker";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

let editor: Editor;
let root: Root;
let mount: HTMLElement;

async function render(node: ReactElement) {
  await act(async () => {
    root.render(node);
  });
}

beforeEach(() => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: buildExtensions(), content: "<p>本文</p>" });
  editor.commands.setTextSelection({ from: 1, to: 3 });
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  document.body.innerHTML = "";
});

function trigger(label: string): HTMLButtonElement {
  return mount.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

/** キーボードで開く: トリガーにフォーカスしてから click（Enter / Space が生むイベント） */
async function openByKeyboard(btn: HTMLButtonElement) {
  await act(async () => {
    btn.focus();
  });
  await act(async () => {
    btn.click();
  });
}

describe("色のパネル", () => {
  it("キーボードで開くと中の見本へフォーカスが入り、click で適用される（mousedown では適用されない）", async () => {
    await render(createElement(InlineColorPicker, { editor }));
    await openByKeyboard(trigger("文字色・背景色"));

    const red = document.querySelector<HTMLButtonElement>('[role="group"] button[aria-label="赤"]')!;
    expect(red).toBeTruthy();
    // 色なしが選択中なので、先頭（デフォルト）が Tab の停止点＝初期フォーカス
    const first = document.querySelector<HTMLButtonElement>("[data-roving-item]")!;
    expect(document.activeElement).toBe(first);
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(red.getAttribute("aria-pressed")).toBe("false");

    // mousedown はエディタの選択を守る preventDefault だけで、適用しない
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => {
      red.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    expect(editor.getHTML()).not.toContain("color");

    await act(async () => {
      red.click();
    });
    expect(editor.getHTML()).toContain("rgb(212, 76, 71)");
    // 適用後の選択範囲は保たれる（続けて書ける）
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(3);
  });

  it("矢印キーで見本間を移動でき、Tab の停止点は 1 つだけ", async () => {
    await render(createElement(InlineColorPicker, { editor }));
    await openByKeyboard(trigger("文字色・背景色"));

    const grid = document.querySelector('[role="group"]')!;
    const items = Array.from(grid.querySelectorAll<HTMLButtonElement>("[data-roving-item]"));
    expect(items.filter((el) => el.tabIndex === 0)).toHaveLength(1);

    await act(async () => {
      items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(items[1]);
    expect(items.filter((el) => el.tabIndex === 0)).toEqual([items[1]]);
  });

  it("マウスで開いたときはフォーカスを奪わない", async () => {
    await render(createElement(InlineColorPicker, { editor }));
    editor.view.focus();
    await act(async () => {
      trigger("文字色・背景色").click();
    });
    expect(document.querySelector("[data-roving-item]")).toBeTruthy();
    expect(document.activeElement?.closest("[data-roving-item]")).toBeNull();
    expect(editor.view.hasFocus()).toBe(true);
  });

  it("付いている色の見本が選択中（aria-pressed）になる", async () => {
    editor.chain().setColor("#D44C47").run();
    await render(createElement(InlineColorPicker, { editor }));
    await openByKeyboard(trigger("文字色・背景色"));
    const red = document.querySelector<HTMLButtonElement>('[role="group"] button[aria-label="赤"]')!;
    expect(red.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(red);
  });
});

describe("文字サイズのパネル", () => {
  it("キーボードで開くと選択中（標準）へフォーカスが入り、「大」を click で適用できる", async () => {
    await render(createElement(FontSizePicker, { editor }));
    await openByKeyboard(trigger("文字サイズ"));

    const options = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-roving-item]"));
    expect(options.length).toBeGreaterThan(1);
    const standard = options.find((el) => el.textContent?.includes("標準"))!;
    expect(document.activeElement).toBe(standard);
    expect(standard.getAttribute("aria-pressed")).toBe("true");

    const large = options.find((el) => el.textContent?.includes("大") && !el.textContent.includes("特大"))!;
    expect(large).toBeTruthy();
    await act(async () => {
      large.click();
    });
    expect(editor.getHTML()).toContain("font-size");
  });
});
