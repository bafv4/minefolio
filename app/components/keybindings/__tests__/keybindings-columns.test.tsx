// /keybindings のマウス列のソート挙動（未設定は常に末尾）を守るテスト。
//
// TanStack Table の `sortUndefined: "last"` は **undefined だけ** を見る（null は素通りして
// 通常比較に回り、昇順で先頭に来てしまう）。アクセサが null を返していた回帰があるため、
// 「未設定は undefined を返す」ことを列定義のレベルで固定する。
import { describe, it, expect } from "vitest";
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type TableOptionsResolved,
} from "@tanstack/react-table";
import { createTranslator } from "@/lib/messages";
import { columnPresets, type KeybindingsRow } from "../keybindings-columns";

const t = createTranslator("ja");

/** マウス設定が一切ない走者（キー配置だけ登録している状態） */
const emptyRow: KeybindingsRow = {
  id: "u1",
  slug: "runner",
  mcid: "Runner",
  uuid: null,
  displayName: null,
  customSkinUrl: null,
  keybindings: [],
  keyRemaps: [],
  customActions: [],
  playerConfig: null,
};

const filledRow: KeybindingsRow = {
  ...emptyRow,
  id: "u2",
  slug: "filled",
  playerConfig: {
    mouseDpi: 800,
    gameSensitivity: 0.5,
    rawInput: true,
    windowsSpeed: 6,
    windowsSpeedMultiplier: null,
    keyboardLayout: "US",
  } as KeybindingsRow["playerConfig"],
};

const mouseColumns = columnPresets(t).mouse as ColumnDef<KeybindingsRow>[];

const sortableColumns = mouseColumns.filter((col) => col.enableSorting);

function accessorOf(col: ColumnDef<KeybindingsRow>) {
  const fn = (col as { accessorFn?: (row: KeybindingsRow, index: number) => unknown })
    .accessorFn;
  if (!fn) throw new Error(`accessorFn missing: ${col.id}`);
  return fn;
}

describe("mouse 列のソート設定", () => {
  it("ソート可能な列はすべて未設定を末尾に送る指定を持つ", () => {
    expect(sortableColumns.length).toBeGreaterThan(0);
    for (const col of sortableColumns) {
      expect(
        (col as { sortUndefined?: unknown }).sortUndefined,
        `${col.id} に sortUndefined: "last" がない`,
      ).toBe("last");
    }
  });

  it("マウス設定が無い走者では undefined を返す（null を返さない）", () => {
    for (const col of sortableColumns) {
      const value = accessorOf(col)(emptyRow, 0);
      expect(value, `${col.id} が null/その他を返した`).toBeUndefined();
    }
  });

  it("マウス設定がある走者では数値を返す", () => {
    for (const col of sortableColumns) {
      const value = accessorOf(col)(filledRow, 0);
      expect(typeof value, `${col.id} が数値を返さなかった`).toBe("number");
    }
  });
});

/**
 * 実際に TanStack の並び替えを通して行の順序を得る（React 描画は不要）。
 * sorting は固定なので state 更新は受け取らない。
 */
function sortedSlugs(rows: KeybindingsRow[], sorting: SortingState): string[] {
  const table = createTable<KeybindingsRow>({
    data: rows,
    columns: mouseColumns,
    state: { sorting },
    onStateChange: () => {},
    renderFallbackValue: null,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  } as TableOptionsResolved<KeybindingsRow>);
  return table.getRowModel().rows.map((r) => r.original.slug);
}

describe("mouse 列の並び替え - 未設定は昇順・降順のどちらでも末尾", () => {
  const dpi800: KeybindingsRow = { ...filledRow, id: "a", slug: "dpi800" };
  const dpi400: KeybindingsRow = {
    ...filledRow,
    id: "b",
    slug: "dpi400",
    playerConfig: { ...filledRow.playerConfig!, mouseDpi: 400 },
  };
  const noConfig: KeybindingsRow = { ...emptyRow, id: "c", slug: "none" };
  const nullDpi: KeybindingsRow = {
    ...filledRow,
    id: "d",
    slug: "nullDpi",
    playerConfig: { ...filledRow.playerConfig!, mouseDpi: null },
  };
  const rows = [noConfig, dpi800, nullDpi, dpi400];

  it("昇順では値のある行が小さい順に並び、未設定は末尾", () => {
    const result = sortedSlugs(rows, [{ id: "mouse.dpi", desc: false }]);
    expect(result.slice(0, 2)).toEqual(["dpi400", "dpi800"]);
    expect(result.slice(2).sort()).toEqual(["none", "nullDpi"]);
  });

  it("降順でも未設定は末尾のまま（先頭に来ない）", () => {
    const result = sortedSlugs(rows, [{ id: "mouse.dpi", desc: true }]);
    expect(result.slice(0, 2)).toEqual(["dpi800", "dpi400"]);
    expect(result.slice(2).sort()).toEqual(["none", "nullDpi"]);
  });
});
