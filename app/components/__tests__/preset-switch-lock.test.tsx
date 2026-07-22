// @vitest-environment jsdom
// PresetSwitchLock の表示挙動テスト。
// locked=true で子要素を操作不可（pointer-events-none + 半透明 + aria-busy）にし、
// 切替中スピナーを重ねることを検証する。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PresetSwitchLock } from "../preset-switch-lock";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mount: HTMLElement;

async function renderLock(locked: boolean) {
  await act(async () => {
    root.render(
      createElement(PresetSwitchLock, {
        locked,
        children: createElement("button", { type: "button" }, "子要素"),
      }),
    );
  });
}

function wrapper(): HTMLElement {
  return mount.querySelector("[aria-busy]")!;
}
function innerContent(): HTMLElement {
  return wrapper().querySelector(":scope > div")!;
}

beforeEach(() => {
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount());
  mount.remove();
});

describe("PresetSwitchLock", () => {
  it("locked=false は操作可能（aria-busy=false・pointer-events 抑止なし・スピナーなし）", async () => {
    await renderLock(false);
    expect(wrapper().getAttribute("aria-busy")).toBe("false");
    expect(innerContent().className).not.toContain("pointer-events-none");
    expect(wrapper().textContent).not.toContain("切り替えています");
    expect(wrapper().textContent).toContain("子要素");
  });

  it("locked=true は操作不可（aria-busy=true・pointer-events-none・半透明・スピナー表示）", async () => {
    await renderLock(true);
    expect(wrapper().getAttribute("aria-busy")).toBe("true");
    expect(innerContent().className).toContain("pointer-events-none");
    expect(innerContent().className).toContain("opacity-50");
    expect(wrapper().textContent).toContain("切り替えています");
    // 子要素は DOM 上は残る（操作だけ抑止）
    expect(wrapper().textContent).toContain("子要素");
  });
});
