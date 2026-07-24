// @vitest-environment jsdom
// KeyCaptureButton のキー確定挙動のテスト。
// - リマップ先（allowModifiers=false）は単一キーのみ: 修飾キー単体（離すと確定）も受け付ける
// - トリガー/変更元（allowModifiers=true）は修飾キー組み合わせを構築する
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KeyCaptureButton } from "../key-capture-button";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mount: HTMLElement;
let captured: string[];

async function renderButton(allowModifiers: boolean) {
  captured = [];
  await act(async () => {
    root.render(
      createElement(KeyCaptureButton, {
        value: "",
        placeholder: "変更先",
        keyboardLayout: "US",
        onCapture: (k: string) => captured.push(k),
        allowModifiers,
      }),
    );
  });
}

function button(): HTMLButtonElement {
  return mount.querySelector("button")!;
}

function focus() {
  act(() => button().focus());
}

function key(type: "keydown" | "keyup", init: KeyboardEventInit) {
  act(() => {
    button().dispatchEvent(
      new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }),
    );
  });
}

function mouseDown(buttonIndex: number) {
  act(() => {
    button().dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: buttonIndex }),
    );
  });
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

describe("KeyCaptureButton", () => {
  describe("リマップ先（allowModifiers=false）", () => {
    it("修飾キー単体（Shift）は押下では確定せず、離した時に ShiftLeft を確定する", async () => {
      await renderButton(false);
      focus();
      key("keydown", { code: "ShiftLeft", key: "Shift", shiftKey: true });
      expect(captured).toEqual([]); // 押下だけでは確定しない
      key("keyup", { code: "ShiftLeft", key: "Shift", shiftKey: false });
      expect(captured).toEqual(["ShiftLeft"]);
    });

    it("非修飾キーは基底キーのみ確定する（押下中の修飾キーは無視）", async () => {
      await renderButton(false);
      focus();
      key("keydown", { code: "KeyA", key: "a", ctrlKey: true });
      expect(captured).toEqual(["KeyA"]);
    });
  });

  describe("トリガー / 変更元（allowModifiers=true）", () => {
    it("修飾キー押下では確定せず、非修飾キーで組み合わせを確定する", async () => {
      await renderButton(true);
      focus();
      key("keydown", { code: "ControlLeft", key: "Control", ctrlKey: true });
      expect(captured).toEqual([]);
      key("keydown", { code: "KeyX", key: "x", ctrlKey: true });
      expect(captured).toEqual(["Ctrl+KeyX"]);
    });

    it("修飾キー単体を離すと単独キーとして確定する", async () => {
      await renderButton(true);
      focus();
      key("keydown", { code: "ShiftLeft", key: "Shift", shiftKey: true });
      key("keyup", { code: "ShiftLeft", key: "Shift", shiftKey: false });
      expect(captured).toEqual(["ShiftLeft"]);
    });

    it("マウスの進むボタン(button=4)は サイド1(Mouse3) を確定する", async () => {
      await renderButton(true);
      mouseDown(4);
      expect(captured).toEqual(["Mouse3"]);
    });

    it("マウスの戻るボタン(button=3)は サイド2(Mouse4) を確定する", async () => {
      await renderButton(true);
      mouseDown(3);
      expect(captured).toEqual(["Mouse4"]);
    });

    it("左クリック(button=0)では確定しない", async () => {
      await renderButton(true);
      mouseDown(0);
      expect(captured).toEqual([]);
    });
  });

  describe("リマップ先はマウスサイドボタンを受け付けない（キー限定）", () => {
    it("allowModifiers=false ではサイドボタンを無視する", async () => {
      await renderButton(false);
      mouseDown(4);
      mouseDown(3);
      expect(captured).toEqual([]);
    });
  });
});
