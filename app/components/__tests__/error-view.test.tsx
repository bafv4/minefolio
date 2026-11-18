// @vitest-environment jsdom
// ErrorView の 404 見出し: loader が Response に載せた文言を、使える形のときだけ見出しに使う。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ErrorView } from "../layout/error-view";

vi.mock("@/hooks/use-locale", () => ({
  useT: () => (key: string) => key,
}));

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mount: HTMLElement;

beforeEach(() => {
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root.unmount());
  mount.remove();
});

/** isRouteErrorResponse が真になる形（react-router の ErrorResponseImpl と同じプロパティ） */
function routeError(status: number, data: unknown, statusText = status === 404 ? "Not Found" : "Error") {
  return { status, statusText, internal: false, data };
}

function render(error: unknown) {
  // root の砦と同じく <a href> にして、ルーターのコンテキスト無しで描く
  act(() => root.render(createElement(ErrorView, { error, plainLinks: true })));
  return {
    heading: mount.querySelector("h1")?.textContent,
    details: mount.querySelector("h1 + p")?.textContent,
  };
}

describe("ErrorView（404）", () => {
  it("使える文字列なら前後の空白を除いて見出しに使い、説明は確認の案内にする", () => {
    const { heading, details } = render(routeError(404, "  走者が見つかりません  "));
    expect(heading).toBe("走者が見つかりません");
    expect(details).toBe("errorPage.notFoundHint");
  });

  it("80字ちょうどは使う", () => {
    const value = "あ".repeat(80);
    expect(render(routeError(404, value)).heading).toBe(value);
  });

  it.each([
    ["80字超", "あ".repeat(81)],
    ["< を含む", "<b>Not here</b>"],
    ["> を含む", "a > b"],
    ["改行を含む", "一行目\n二行目"],
    ["Error で始まる（ルーター内部の文言）", 'Error: No route matches URL "/nope"'],
    ["既定の statusText と同じ", "Not Found"],
    ["大文字小文字違いの not found", "NOT FOUND"],
    ["空白だけ", "   "],
    ["空文字", ""],
    ["文字列でない", { message: "x" }],
    ["null", null],
  ])("%s は使わず汎用の文言になる", (_label, data) => {
    const { heading, details } = render(routeError(404, data));
    expect(heading).toBe("errorPage.notFoundTitle");
    expect(details).toBe("errorPage.notFoundDetails");
  });

  it("404 以外では data を見出しに使わない", () => {
    const { heading, details } = render(routeError(500, "走者が見つかりません", "Internal Server Error"));
    expect(heading).toBe("errorPage.errorTitle");
    expect(details).toBe("Internal Server Error");
  });
});
