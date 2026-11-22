// MeErrorBoundary: /me 配下の共通エラー面（role=status、見出し・説明・リロードボタン）。
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "@/lib/messages";
import { MeErrorBoundary } from "../me-error-boundary";

describe("MeErrorBoundary", () => {
  const t = createTranslator("ja");
  const html = renderToStaticMarkup(createElement(MeErrorBoundary));

  it("role=status の面で描く", () => {
    expect(html).toMatch(/<div role="status"/);
  });

  it("見出し（h2）と説明の文言を出す", () => {
    expect(html).toContain(`<h2 class="text-2xl font-bold">${t("meErrorBoundary.title")}</h2>`);
    expect(html).toContain(t("meErrorBoundary.description"));
  });

  it("リロードのボタンがある", () => {
    expect(html).toMatch(new RegExp(`<button[^>]*>${t("meErrorBoundary.reload")}</button>`));
  });
});
