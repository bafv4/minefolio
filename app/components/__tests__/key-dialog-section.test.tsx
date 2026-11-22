// @vitest-environment jsdom
// KeyDialogSection: defaultOpen は初回だけに効き、編集中に件数が変わっても開閉状態を保つ。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KeyDialogSection } from "../keybindings/key-dialog-section";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mount: HTMLElement;

async function renderSection(defaultOpen: boolean, key = "a") {
  await act(async () => {
    root.render(
      createElement(KeyDialogSection, {
        key,
        title: "段",
        defaultOpen,
        children: createElement("input"),
      }),
    );
  });
}

beforeEach(() => {
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
});

describe("KeyDialogSection", () => {
  it("defaultOpen が true なら初回は開いている", async () => {
    await renderSection(true);
    expect(mount.querySelector("details")!.open).toBe(true);
  });

  it("defaultOpen が true→false に変わっても開いたまま（件数 1→0）", async () => {
    await renderSection(true);
    await renderSection(false);
    expect(mount.querySelector("details")!.open).toBe(true);
  });

  it("key が変わると作り直されて defaultOpen が再び効く", async () => {
    await renderSection(true, "a");
    await renderSection(false, "b");
    expect(mount.querySelector("details")!.open).toBe(false);
  });
});
