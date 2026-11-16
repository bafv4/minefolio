// @vitest-environment jsdom
// KeyInfoTrigger のモバイル挙動のテスト。
// 編集モード（interactive）では、モバイルでも情報ダイアログの DialogTrigger でキーを包まない
// （編集ダイアログと2枚同時に開いてしまう問題の回帰防止）。閲覧モードは従来どおり Dialog で包む。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KeyInfoTrigger } from "../key-info-trigger";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mount: HTMLElement;

beforeEach(() => {
  // モバイル幅（max-width: 767px にマッチ）として扱う
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
});

async function renderTrigger(interactive: boolean) {
  await act(async () => {
    root.render(
      createElement(KeyInfoTrigger, {
        info: { title: "E" },
        alwaysShow: true,
        interactive,
        children: createElement("button", { type: "button" }, "E"),
      }),
    );
  });
  return mount.querySelector("button")!;
}

describe("KeyInfoTrigger（モバイル）", () => {
  it("interactive のときはキーを DialogTrigger で包まない（ダイアログを開く属性が付かない）", async () => {
    const btn = await renderTrigger(true);
    expect(btn.getAttribute("aria-haspopup")).toBeNull();
    await act(async () => btn.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("閲覧モード（interactive でない）ではキーが情報ダイアログの引き金になる", async () => {
    const btn = await renderTrigger(false);
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    await act(async () => btn.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
