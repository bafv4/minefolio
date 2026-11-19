import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/messages";
import { filterSlashItems } from "../items";
import { resolveSlashKey } from "../renderer";

const t = createTranslator("ja");

describe("filterSlashItems → Enter で実行される項目", () => {
  it("「サーチ」は先頭がサーチクラフト（リマップではない）", () => {
    const items = filterSlashItems("サーチ", t);
    expect(items[0].title).toBe(t("guideEditor.slash.searchCraftEmbed"));
    expect(items.map((i) => i.title)).not.toContain(t("guideEditor.slash.keybindEmbed"));
  });

  it("表示順の配列がそのまま選択の添字に対応する（Down 1 回でテンプレート）", () => {
    const items = filterSlashItems("さーち", t);
    const action = resolveSlashKey({ key: "ArrowDown" }, 0, items.length);
    expect(action).toEqual({ type: "move", selectedIndex: 1 });
    expect(items[1].title).toBe(t("guideEditor.slash.searchCraftTemplateEmbed"));
  });
});

describe("resolveSlashKey", () => {
  it("矢印は循環し、Enter は選択、Escape は閉じる", () => {
    expect(resolveSlashKey({ key: "ArrowUp" }, 0, 3)).toEqual({ type: "move", selectedIndex: 2 });
    expect(resolveSlashKey({ key: "ArrowDown" }, 2, 3)).toEqual({ type: "move", selectedIndex: 0 });
    expect(resolveSlashKey({ key: "Enter" }, 0, 3)).toEqual({ type: "select" });
    expect(resolveSlashKey({ key: "Escape" }, 0, 3)).toEqual({ type: "dismiss" });
  });

  it("IME 変換中のキー（矢印・確定の Enter）は無視する", () => {
    expect(resolveSlashKey({ key: "ArrowDown", isComposing: true }, 0, 3)).toEqual({ type: "ignore" });
    expect(resolveSlashKey({ key: "Enter", keyCode: 229 }, 0, 3)).toEqual({ type: "ignore" });
  });
});
