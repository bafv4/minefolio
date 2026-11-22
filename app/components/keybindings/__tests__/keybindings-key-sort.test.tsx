// キー名（アクション列）の並べ替え。表（TanStack の sortFn）とビジュアル（sortKeybindingsRows）が
// 同じ順になること、未割り当ては昇順・降順どちらでも末尾になることを固定する。
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useTable, type SortingState } from "@tanstack/react-table";
import { createTranslator } from "@/lib/messages";
import {
  columnPresets,
  keybindingsTableFeatures,
  sortKeybindingsRows,
  type KeybindingsColumnDef,
  type KeybindingsRow,
} from "../keybindings-columns";

const t = createTranslator("ja");

function row(
  slug: string,
  sprint: string | undefined,
  layout: string | null = "US",
  extra: Partial<KeybindingsRow> = {},
): KeybindingsRow {
  return {
    id: slug,
    slug,
    mcid: slug,
    uuid: null,
    displayName: null,
    customSkinUrl: null,
    keybindings: sprint ? [{ id: `${slug}-k`, action: "sprint", keyCode: sprint, category: "movement" }] : [],
    keyRemaps: [],
    customActions: [],
    playerConfig: { keyboardLayout: layout } as KeybindingsRow["playerConfig"],
    ...extra,
  };
}

const rows = [
  row("none", undefined),
  row("f10", "F10"),
  row("w", "KeyW"),
  row("f2", "F2"),
  row("a", "KeyA"),
  row("unbound", "_UNBOUND"),
];

const movementColumns = columnPresets(t, "ja").movement as KeybindingsColumnDef[];

function tableOrder(sorting: SortingState, data: KeybindingsRow[] = rows): string[] {
  let slugs: string[] = [];
  function Probe() {
    const table = useTable({
      features: keybindingsTableFeatures,
      data,
      columns: movementColumns,
      state: { sorting },
      onSortingChange: () => {},
    });
    slugs = table.getRowModel().rows.map((r) => r.original.slug);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return slugs;
}

const visualOrder = (direction: "asc" | "desc", data: KeybindingsRow[] = rows) =>
  sortKeybindingsRows(data, { key: "action.sprint", direction }, t, "ja").map((r) => r.slug);

describe("アクション列はキー名で並べ替えられる", () => {
  it("アクション列は並べ替え可能で、未割り当ては末尾に送る指定を持つ", () => {
    const col = movementColumns.find((c) => c.id === "action.sprint");
    expect(col?.enableSorting).toBe(true);
    expect((col as { sortUndefined?: unknown }).sortUndefined).toBe("last");
  });

  it("昇順: 数値順（F2 < F10）で、未割り当て・不使用は末尾", () => {
    const order = tableOrder([{ id: "action.sprint", desc: false }]);
    expect(order.indexOf("f2")).toBeLessThan(order.indexOf("f10"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("w"));
    expect(order.slice(4).sort()).toEqual(["none", "unbound"]);
  });

  it("降順でも未割り当ては末尾のまま", () => {
    const order = tableOrder([{ id: "action.sprint", desc: true }]);
    expect(order.indexOf("w")).toBeLessThan(order.indexOf("a"));
    expect(order.indexOf("f10")).toBeLessThan(order.indexOf("f2"));
    expect(order.slice(4).sort()).toEqual(["none", "unbound"]);
  });

  it("ビジュアルの並べ替え（URL の sort）は表と同じ順", () => {
    expect(visualOrder("asc").slice(0, 4)).toEqual(
      tableOrder([{ id: "action.sprint", desc: false }]).slice(0, 4),
    );
    expect(visualOrder("desc").slice(0, 4)).toEqual(
      tableOrder([{ id: "action.sprint", desc: true }]).slice(0, 4),
    );
    expect(visualOrder("desc").slice(4).sort()).toEqual(["none", "unbound"]);
  });

  it("並べ替えのキーは、その走者の配列を考慮した表示ラベル", () => {
    // JIS の Backquote は「半角」、US の Backquote は「`」。ラベル順で並ぶ
    const jis = row("jis", "Backquote", "JIS");
    const us = row("us", "Backquote", "US");
    const labelOrder = sortKeybindingsRows([jis, us], { key: "action.sprint", direction: "asc" }, t, "ja").map(
      (r) => r.slug,
    );
    expect(labelOrder).toEqual(["us", "jis"]);
  });

  it("カスタムキー名があれば、表示と同じくその名前で並べる", () => {
    const custom = row("custom", "KeyZ", "US", {
      customKeys: [{ keyCode: "KeyZ", keyName: "A-Custom", category: "other" }],
    });
    const plain = row("plain", "KeyB");
    expect(
      sortKeybindingsRows([plain, custom], { key: "action.sprint", direction: "asc" }, t, "ja").map(
        (r) => r.slug,
      ),
    ).toEqual(["custom", "plain"]);
  });

  it("同じキー名の行は元の順を保つ（安定）", () => {
    const x1 = row("x1", "KeyX");
    const x2 = row("x2", "KeyX");
    expect(
      sortKeybindingsRows([x2, x1], { key: "action.sprint", direction: "desc" }, t, "ja").map((r) => r.slug),
    ).toEqual(["x2", "x1"]);
  });

  it("未知のキーの sort は元の順を返す", () => {
    expect(sortKeybindingsRows(rows, { key: "bogus", direction: "asc" }, t, "ja")).toBe(rows);
  });
});
