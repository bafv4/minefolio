// /keybindings の TanStack Table 本体。
// CSS Grid Table（role="table"）。左端の走者列は sticky left で固定する。
//
// 行は仮想化しない（走者は高々数百で、タブごとに 1 つの表しか描かれない）。
// 仮想化していた頃は、見積もり行高と実測のずれで行の間に隙間が出る・SSR で本体の行が出ない・
// md 未満でページスクロールに任せられない（スクロール要素が表の内側に固定される）という問題があった。
//
// 見出し行は横スクロール枠の外に置き、本体の scrollLeft に追従させる（CSS 変数 --kb-scroll-left）。
// 横スクロール枠（overflow-x）の内側に置くと、sticky がページではなくその枠を基準にしてしまい、
// md 未満でページに貼り付けられないため。md 以上は本体を max-h の縦スクロール枠にし、見出しは枠の上に静止する。
import { useMemo, useRef, type CSSProperties } from "react";
import { flexRender, useTable, type SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  columnPresets,
  keybindingsTableFeatures,
  type KeybindingsColumnDef,
  type KeybindingsRow,
  type PresetKey,
} from "./keybindings-columns";
import { KeybindingsEmptyState } from "./keybindings-empty-state";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { useT } from "@/hooks/use-locale";

interface KeybindingsTableProps {
  rows: KeybindingsRow[];
  preset: PresetKey;
  /** 表のアクセシブルネームに使うタブ名 */
  label: string;
}

/** 走者列の既定幅（md 未満は頭＋名前の縦並びなので狭い）。リサイズ後は px で上書きする */
const RUNNER_COLUMN_WIDTH = "[--kb-runner-col:96px] md:[--kb-runner-col:224px]";

export function KeybindingsTable({ rows, preset, label }: KeybindingsTableProps) {
  const t = useT();
  const columns = useMemo<KeybindingsColumnDef[]>(
    () => columnPresets(t)[preset] as KeybindingsColumnDef[],
    [preset, t],
  );
  const { sort, setSort } = useKeybindingsFilters();

  // TanStack Table の sorting state を URL の sort と同期
  const sorting: SortingState = useMemo(() => {
    if (!sort) return [];
    return [{ id: sort.key, desc: sort.direction === "desc" }];
  }, [sort]);

  const table = useTable({
    features: keybindingsTableFeatures,
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      if (!first) {
        setSort(null, null);
      } else {
        setSort(first.id, first.desc ? "desc" : "asc");
      }
    },
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    defaultColumn: { minSize: 48 },
  });

  // 列リサイズの現在値（columnSizing が変わるたびに gridTemplateColumns を再計算）
  const columnSizing = table.state.columnSizing;
  const rowModel = table.getRowModel();

  // grid-template-columns: リサイズ後の実サイズ（getSize）を px で連結。
  // 走者列だけ、リサイズされるまでは CSS 変数（md 未満/以上で幅が違う）を使う
  const gridTemplateColumns = useMemo(
    () =>
      table
        .getAllLeafColumns()
        .map((col) =>
          col.id === "runner" && columnSizing.runner == null
            ? "var(--kb-runner-col)"
            : `${col.getSize()}px`,
        )
        .join(" "),
    // table はレンダーごとに生成されるため依存に含めない。
    // 実際に幅が変わるのは columnSizing / columns の変化時のみ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnSizing, columns],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  // 本体の横スクロール量を見出しへ渡す（再レンダーなしで CSS 変数に書く）
  const syncHeaderScroll = (scrollLeft: number) => {
    rootRef.current?.style.setProperty("--kb-scroll-left", `${scrollLeft}px`);
  };

  if (rowModel.rows.length === 0) return <KeybindingsEmptyState />;

  const headers = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div
      ref={rootRef}
      role="table"
      aria-label={t("keybindings.tableLabel", { tab: label })}
      aria-rowcount={rowModel.rows.length + 1}
      className={cn("relative bg-card", RUNNER_COLUMN_WIDTH)}
    >
      {/* 見出し行: md 未満はページの上端（サイトヘッダーの下）に貼り付く。
          中身は本体の scrollLeft ぶん逆向きにずらし、走者列だけ打ち消して固定する */}
      <div className="overflow-hidden border-b-2 border-border bg-muted max-md:sticky max-md:top-[64px] max-md:z-30">
        <div
          role="rowgroup"
          className="w-max min-w-full"
          style={
            { transform: "translateX(calc(var(--kb-scroll-left, 0px) * -1))" } as CSSProperties
          }
        >
          <div
            role="row"
            aria-rowindex={1}
            className="grid text-sm font-medium"
            style={{ gridTemplateColumns }}
          >
            {headers.map((header, idx) => {
              const canSort = header.column.getCanSort();
              const sortDir = header.column.getIsSorted();
              const align =
                (header.column.columnDef.meta as { align?: string } | undefined)
                  ?.align ?? "left";
              const isFirst = idx === 0;
              const canResize = header.column.getCanResize();
              return (
                <div
                  role="columnheader"
                  key={header.id}
                  aria-sort={
                    canSort
                      ? sortDir === "asc"
                        ? "ascending"
                        : sortDir === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                  className={cn(
                    "relative flex items-center gap-1 border-r border-border/60 px-2 py-2",
                    align === "center" && "justify-center text-center",
                    align === "right" && "justify-end text-right",
                    isFirst && "z-10 border-r-2 bg-muted",
                  )}
                  style={
                    isFirst
                      ? ({ transform: "translateX(var(--kb-scroll-left, 0px))" } as CSSProperties)
                      : undefined
                  }
                >
                  {canSort ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="inline-flex min-w-0 items-center gap-1 rounded text-inherit transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
                    >
                      {/* 省略せず折り返して全文を読めるようにする */}
                      <span className="min-w-0 break-words leading-snug">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </span>
                      {sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
                      ) : sortDir === "desc" ? (
                        <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    <span className="min-w-0 break-words leading-snug">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                  )}

                  {/* リサイズハンドル（右端をドラッグ） */}
                  {canResize && (
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none touch-none",
                        "hover:bg-primary/40",
                        header.column.getIsResizing() && "bg-primary/60",
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 本体: 横スクロール枠。md 以上は縦にも最大 70vh でスクロールし、md 未満はページのスクロールに任せる */}
      <div
        role="rowgroup"
        onScroll={(e) => syncHeaderScroll(e.currentTarget.scrollLeft)}
        className="custom-scrollbar overflow-x-auto [overscroll-behavior-x:contain] md:max-h-[70vh] md:overflow-y-auto md:[overscroll-behavior-y:contain]"
      >
        {rowModel.rows.map((row, rowIndex) => (
          <div
            role="row"
            key={row.id}
            aria-rowindex={rowIndex + 2}
            className="grid w-max min-w-full border-b border-border/40 hover:bg-muted/30"
            style={{ gridTemplateColumns }}
          >
            {row.getAllCells().map((cell, idx) => {
              const align =
                (cell.column.columnDef.meta as { align?: string } | undefined)
                  ?.align ?? "left";
              const isFirst = idx === 0;
              return (
                <div
                  role="cell"
                  key={cell.id}
                  className={cn(
                    "flex min-w-0 items-center overflow-hidden px-2 py-2",
                    align === "center" && "justify-center",
                    align === "right" && "justify-end",
                    isFirst &&
                      "sticky left-0 z-10 border-r-2 border-border bg-card",
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
