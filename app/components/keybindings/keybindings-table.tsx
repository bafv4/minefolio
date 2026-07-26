// /keybindings の TanStack Table 本体。
// CSS Grid Table（role="grid"）+ TanStack Virtual で sticky 左列を安定化しつつ大量行に対応。
import { useMemo, useRef } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type CellContext,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  columnPresets,
  type KeybindingsRow,
  type PresetKey,
} from "./keybindings-columns";
import { RunnerCell } from "./keybindings-cells";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useT } from "@/hooks/use-locale";

const ROW_ESTIMATED_SIZE = 56;
/** remaps / custom-actions は内容次第で背丈が伸びるため、初期見積もりを上げる */
const ROW_ESTIMATED_SIZE_DYNAMIC = 80;
/** モバイル: 走者セルが縦並び（頭＋名前）になるぶん背丈が高い */
const ROW_ESTIMATED_SIZE_MOBILE = 76;
/** モバイル時の走者列の初期幅・最小幅（頭＋名前の縦並びに合わせて狭める） */
const RUNNER_COL_SIZE_MOBILE = 96;
const RUNNER_COL_MIN_SIZE_MOBILE = 72;

interface KeybindingsTableProps {
  rows: KeybindingsRow[];
  preset: PresetKey;
}

export function KeybindingsTable({ rows, preset }: KeybindingsTableProps) {
  const t = useT();
  const isMobile = useMediaQuery("(max-width: 767px)", false);
  // モバイルでは走者列を狭め、セルを縦並び（頭＋名前）の compact 表示に差し替える。
  // 列幅は TanStack の size（px）で決まり CSS では切り替えられないため JS 側で分岐する。
  const columns = useMemo<ColumnDef<KeybindingsRow>[]>(() => {
    const base = columnPresets(t)[preset] as ColumnDef<KeybindingsRow>[];
    if (!isMobile) return base;
    return base.map((col) =>
      col.id === "runner"
        ? ({
            ...col,
            size: RUNNER_COL_SIZE_MOBILE,
            minSize: RUNNER_COL_MIN_SIZE_MOBILE,
            cell: ({ row }: CellContext<KeybindingsRow, unknown>) => (
              <RunnerCell player={row.original} variant="compact" />
            ),
          } as ColumnDef<KeybindingsRow>)
        : col,
    );
  }, [preset, isMobile]);
  const { sort, setSort } = useKeybindingsFilters();

  // TanStack Table の sorting state を URL の sort と同期
  const sorting: SortingState = useMemo(() => {
    if (!sort) return [];
    return [{ id: sort.key, desc: sort.direction === "desc" }];
  }, [sort]);

  const table = useReactTable({
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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // 列リサイズの現在値（columnSizing が変わるたびに gridTemplateColumns を再計算）
  const columnSizing = table.getState().columnSizing;

  const rowModel = table.getRowModel();

  // スクロールコンテナ
  const scrollRef = useRef<HTMLDivElement>(null);

  const isDynamic = preset === "remaps" || preset === "custom-actions";
  // モバイルの compact 走者セルは固定見積もりより高くなるため、行の実測を有効化して
  // 仮想化行が重ならないようにする（dynamic プリセットと同じ仕組み）。
  const measureRows = isDynamic || isMobile;
  const virtualizer = useVirtualizer({
    count: rowModel.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () =>
      isDynamic
        ? ROW_ESTIMATED_SIZE_DYNAMIC
        : isMobile
          ? ROW_ESTIMATED_SIZE_MOBILE
          : ROW_ESTIMATED_SIZE,
    overscan: 8,
    measureElement: measureRows
      ? (el) => el.getBoundingClientRect().height
      : undefined,
  });

  // grid-template-columns 値: リサイズ後の実サイズ（getSize）を px で連結
  const gridTemplateColumns = useMemo(
    () =>
      table
        .getVisibleLeafColumns()
        .map((col) => `${col.getSize()}px`)
        .join(" "),
    // table はレンダーごとに生成されるため依存に含めない。
    // 実際に幅が変わるのは columnSizing / columns の変化時のみ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnSizing, columns],
  );

  const headers = table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div
      ref={scrollRef}
      role="grid"
      className="custom-scrollbar relative overflow-auto max-h-[70vh] [overscroll-behavior:contain] bg-card"
    >
      {/* ヘッダ行（仮想化外、sticky top） */}
      {/* w-max min-w-full: 横スクロール時にヘッダ全体が描画されるよう、
          ボックス幅を「列の合計幅」と「コンテナ幅」の大きい方に広げる。
          （sticky top + 横スクロールで背景・境界線がビューポート幅に切り詰められる問題への対処） */}
      <div
        role="row"
        className="sticky top-0 z-30 grid w-max min-w-full bg-muted border-b-2 border-border text-sm font-medium"
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
              className={cn(
                "relative flex items-center gap-1 px-2 py-2 border-r border-border/60 whitespace-nowrap overflow-hidden",
                align === "center" && "justify-center",
                align === "right" && "justify-end",
                isFirst && "sticky left-0 z-10 bg-muted border-r-2",
              )}
            >
              {canSort ? (
                <button
                  type="button"
                  onClick={header.column.getToggleSortingHandler()}
                  className="inline-flex items-center gap-1 min-w-0 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  <span className="truncate">
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
                <span className="truncate">
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

      {/* 仮想化された行 */}
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rowModel.rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              role="row"
              key={row.id}
              ref={measureRows ? virtualizer.measureElement : undefined}
              data-index={virtualRow.index}
              className="absolute top-0 left-0 grid w-max min-w-full hover:bg-muted/30 border-b border-border/40"
              style={{
                gridTemplateColumns,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.getVisibleCells().map((cell, idx) => {
                const align =
                  (cell.column.columnDef.meta as { align?: string } | undefined)
                    ?.align ?? "left";
                const isFirst = idx === 0;
                return (
                  <div
                    role="gridcell"
                    key={cell.id}
                    className={cn(
                      "flex items-center px-2 py-2 min-w-0 overflow-hidden",
                      align === "center" && "justify-center",
                      align === "right" && "justify-end",
                      isFirst &&
                        "sticky left-0 z-10 bg-card border-r-2 border-border",
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {rowModel.rows.length === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          {t("keybindings.noPlayers")}
        </div>
      )}
    </div>
  );
}
