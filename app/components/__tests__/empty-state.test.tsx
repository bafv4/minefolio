// EmptyState: description は省略可。省略時は説明の <p> を描かず、渡したときは default / compact の両方で描く。
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "../empty-state";

const icon = createElement("svg", { "data-testid": "icon" });

function render(props: { size?: "default" | "compact"; description?: string }) {
  return renderToStaticMarkup(createElement(EmptyState, { icon, title: "タイトル", ...props }));
}

describe.each(["default", "compact"] as const)("EmptyState (%s)", (size) => {
  it("description を渡すと説明の <p> を描く", () => {
    const html = render({ size, description: "補足の文" });
    expect(html).toContain("タイトル");
    expect(html).toMatch(/<p class="[^"]*">補足の文<\/p>/);
  });

  it("description を省略すると説明の <p> を描かない（タイトルは既定で p なので 1 つだけ）", () => {
    const html = render({ size });
    expect(html).toContain("タイトル");
    expect(html.match(/<p[\s>]/g)).toHaveLength(1);
  });
});
